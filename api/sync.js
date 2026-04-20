import { createClient } from '@supabase/supabase-js';

const PLOOMES_BASE = 'https://api2.ploomes.com';
const SOURCE_FIELD_KEY = 'deal_DD42394B-5712-4BC1-A8A9-7EBC4AA4522C';
const CLOSER_PIPELINE_NAME = 'closer';
const MIN_INTERVAL_MS = 650;
let lastRequestAt = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function toIso(v) { return v ? new Date(v).toISOString() : null; }
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function ploomesRequest(endpoint, attempt = 1) {
  const key = process.env.PLOOMES_USER_KEY;
  if (!key) throw new Error('PLOOMES_USER_KEY not set');

  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - elapsed);
  lastRequestAt = Date.now();

  const url = endpoint.startsWith('http') ? endpoint : `${PLOOMES_BASE}${endpoint}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Key': key },
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    if (attempt < 3) { await sleep(2000 * attempt); return ploomesRequest(endpoint, attempt + 1); }
    throw new Error(`Ploomes inacessível: ${e.message}`);
  }
  clearTimeout(timeout);

  const text = await res.text();
  const isHtml = /^\s*<(!doctype|html)/i.test(text);
  if (isHtml || [502, 503, 504, 522, 524].includes(res.status)) {
    if (attempt < 3) { await sleep(2000 * attempt); return ploomesRequest(endpoint, attempt + 1); }
    throw new Error(`Ploomes indisponível (HTTP ${res.status})`);
  }

  try { return text ? JSON.parse(text) : {}; }
  catch { throw new Error(`Resposta inválida do Ploomes: ${text.slice(0, 200)}`); }
}

async function fetchAllPages(base) {
  const results = [];
  let url = base;
  while (url) {
    const data = await ploomesRequest(url);
    results.push(...(data?.value ?? []));
    const next = data?.['@odata.nextLink'];
    url = next ? (next.startsWith('http') ? next : `${PLOOMES_BASE}${next}`) : null;
  }
  return results;
}

async function upsertBatch(client, table, rows) {
  for (const batch of chunk(rows, 500)) {
    const { error } = await client.from(table).upsert(batch, { onConflict: 'id' });
    if (error) throw new Error(`Upsert ${table}: ${error.message}`);
  }
}

async function readSyncState(client, key) {
  const { data } = await client.from('ploomes_sync_state').select('value').eq('key', key).maybeSingle();
  return data?.value?.last_sync_at ? new Date(data.value.last_sync_at) : null;
}

async function writeSyncState(client, key, value) {
  await client.from('ploomes_sync_state').upsert({ key, value: { last_sync_at: value } }, { onConflict: 'key' });
}

function overlapIso(date) {
  return date ? new Date(date.getTime() - 10 * 60 * 1000).toISOString() : null;
}

async function syncReferenceData(client) {
  const syncedAt = new Date().toISOString();
  const [pipelines, users, lostReasons] = await Promise.all([
    fetchAllPages('/Deals@Pipelines?$expand=Stages&$top=1000'),
    fetchAllPages('/Users?$top=1000'),
    fetchAllPages('/Deals@LossReasons?$top=1000'),
  ]);
  await Promise.all([
    upsertBatch(client, 'ploomes_pipelines', pipelines.map(p => ({ id: p.Id, name: p.Name, stages: p.Stages ?? [], synced_at: syncedAt }))),
    upsertBatch(client, 'ploomes_users', users.map(u => ({ id: u.Id, name: u.Name, email: u.Email ?? null, synced_at: syncedAt }))),
    upsertBatch(client, 'ploomes_lost_reasons', lostReasons.map(r => ({ id: r.Id, name: r.Name, synced_at: syncedAt }))),
  ]);
  return { pipelines, users, lostReasons };
}

async function syncDeals(client, pipelineIds) {
  const since = overlapIso(await readSyncState(client, 'ploomes_deals'));
  const syncedAt = new Date().toISOString();

  for (const pid of pipelineIds) {
    let url = since
      ? `/Deals?$filter=PipelineId eq ${pid} and LastUpdateDate ge ${since}&$expand=OtherProperties&$orderby=LastUpdateDate asc`
      : `/Deals?$filter=PipelineId eq ${pid}&$expand=OtherProperties&$orderby=LastUpdateDate asc`;

    while (url) {
      const data = await ploomesRequest(url);
      const page = data?.value ?? [];
      if (page.length > 0) {
        const rows = page.map(d => {
          let source = null;
          if (Array.isArray(d.OtherProperties)) {
            const p = d.OtherProperties.find(p => p.FieldKey === SOURCE_FIELD_KEY);
            if (p) source = p.StringValue || p.ObjectValueName || p.BigStringValue || null;
          }
          return {
            id: d.Id, pipeline_id: d.PipelineId, stage_id: d.StageId ?? null,
            contact_id: d.ContactId ?? null, owner_id: d.OwnerId ?? null,
            amount: d.Amount ?? null, status_id: d.StatusId ?? null,
            create_date: toIso(d.CreateDate), start_date: toIso(d.StartDate),
            finish_date: toIso(d.FinishDate), won_date: toIso(d.WonDate),
            lost_date: toIso(d.LostDate), last_update_date: toIso(d.LastUpdateDate),
            loss_reason_id: d.LossReasonId ?? d.LostReasonId ?? null,
            title: d.Title ?? null, contact_name: d.ContactName ?? null,
            source, synced_at: syncedAt,
          };
        });
        await upsertBatch(client, 'ploomes_deals', rows);
      }
      const next = data?.['@odata.nextLink'];
      url = next ? (next.startsWith('http') ? next : `${PLOOMES_BASE}${next}`) : null;
    }
  }
  await writeSyncState(client, 'ploomes_deals', syncedAt);
}

async function syncTasks(client) {
  const since = overlapIso(await readSyncState(client, 'ploomes_tasks'));
  const syncedAt = new Date().toISOString();
  const endpoint = since
    ? `/Tasks?$filter=DealId ne null and LastUpdateDate ge ${since}`
    : `/Tasks?$filter=DealId ne null`;

  let url = endpoint;
  while (url) {
    const data = await ploomesRequest(url);
    const page = data?.value ?? [];
    if (page.length > 0) {
      const rows = page.map(t => ({
        id: t.Id, deal_id: t.DealId, user_id: t.OwnerId ?? t.UserId ?? null,
        due_date: toIso(t.DateTime ?? t.DueDate), finish_date: toIso(t.FinishDate),
        status: t.Finished ? 1 : (t.Status ?? 0),
        status_text: t.StatusText ?? (t.Finished ? 'Completed' : 'Pending'),
        title: t.Title ?? null, description: t.Description ?? null,
        last_update_date: toIso(t.LastUpdateDate), synced_at: syncedAt,
      }));
      await upsertBatch(client, 'ploomes_tasks', rows);
    }
    const next = data?.['@odata.nextLink'];
    url = next ? (next.startsWith('http') ? next : `${PLOOMES_BASE}${next}`) : null;
  }
  await writeSyncState(client, 'ploomes_tasks', syncedAt);
}

async function syncQuotes(client) {
  const since = overlapIso(await readSyncState(client, 'ploomes_quotes'));
  const syncedAt = new Date().toISOString();
  const endpoint = since
    ? `/Quotes?$filter=LastUpdateDate ge ${since}&$orderby=LastUpdateDate asc`
    : `/Quotes?$orderby=LastUpdateDate asc`;

  let url = endpoint;
  while (url) {
    const data = await ploomesRequest(url);
    const page = data?.value ?? [];
    if (page.length > 0) {
      const rows = page.map(q => ({
        id: q.Id, deal_id: q.DealId ?? null, contact_id: q.ContactId ?? null,
        contact_name: q.ContactName ?? null, owner_id: q.OwnerId ?? null,
        amount: q.Amount ?? null, discount: q.Discount ?? null,
        quote_number: q.QuoteNumber ?? null, date: toIso(q.Date),
        create_date: toIso(q.CreateDate), last_update_date: toIso(q.LastUpdateDate),
        expiration_date: toIso(q.ExpirationDate), title: q.Title ?? null,
        file_name: q.FileName ?? null, document_url: q.DocumentUrl ?? null,
        synced_at: syncedAt,
      }));
      await upsertBatch(client, 'ploomes_quotes', rows);
    }
    const next = data?.['@odata.nextLink'];
    url = next ? (next.startsWith('http') ? next : `${PLOOMES_BASE}${next}`) : null;
  }
  await writeSyncState(client, 'ploomes_quotes', syncedAt);
}

export default async function handler(req, res) {
  // Aceita GET (GitHub Actions) ou POST (manual)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Segurança: valida token
  const token = req.headers['x-sync-token'] || req.query.token;
  if (token !== process.env.SYNC_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );

  const startedAt = Date.now();
  try {
    console.log('[sync] Iniciando sincronização...');
    const ref = await syncReferenceData(supabase);
    const closer = ref.pipelines.find(p => p.Name?.toLowerCase() === CLOSER_PIPELINE_NAME);
    if (!closer) throw new Error('Pipeline "Closer" não encontrado no Ploomes');

    await syncDeals(supabase, [closer.Id]);
    await syncTasks(supabase);
    await syncQuotes(supabase);

    // Invalida snapshot para forçar rebuild na próxima leitura
    await supabase.from('crm_dashboard_snapshots').delete().eq('key', 'default');

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(`[sync] Concluído em ${elapsed}s`);
    return res.status(200).json({ ok: true, elapsed_seconds: elapsed, synced_at: new Date().toISOString() });
  } catch (err) {
    console.error('[sync] Erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
