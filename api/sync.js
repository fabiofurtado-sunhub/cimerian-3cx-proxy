import { createClient } from '@supabase/supabase-js';

const PLOOMES_BASE = 'https://api2.ploomes.com';
const SOURCE_FIELD_KEY = 'deal_DD42394B-5712-4BC1-A8A9-7EBC4AA4522C';
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
  const timeout = setTimeout(() => controller.abort(), 8000);
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Key': key }, signal: controller.signal });
  } catch (e) {
    clearTimeout(timeout);
    if (attempt < 2) { await sleep(1000); return ploomesRequest(endpoint, attempt + 1); }
    throw new Error(`Ploomes inacessível: ${e.message}`);
  }
  clearTimeout(timeout);
  const text = await res.text();
  if (/^\s*<(!doctype|html)/i.test(text) || [502, 503, 504, 522, 524].includes(res.status)) {
    if (attempt < 2) { await sleep(1000); return ploomesRequest(endpoint, attempt + 1); }
    throw new Error(`Ploomes indisponível (HTTP ${res.status})`);
  }
  try { return text ? JSON.parse(text) : {}; }
  catch { throw new Error(`Resposta inválida: ${text.slice(0, 200)}`); }
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

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );
}

function authCheck(req) {
  const token = req.headers['x-sync-token'] || req.query.token;
  return token === process.env.SYNC_SECRET;
}

async function syncRefs(client) {
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
  const closer = pipelines.find(p => p.Name?.toLowerCase() === 'closer');
  return { pipelineId: closer?.Id ?? null };
}

async function syncDealsPage(client, pipelineId) {
  const syncedAt = new Date().toISOString();
  const { data: stateRow } = await client.from('ploomes_sync_state').select('value').eq('key', 'ploomes_deals_cursor').maybeSingle();
  const cursor = stateRow?.value?.next_url ?? null;

  let url;
  if (cursor) {
    url = cursor;
  } else {
    const lastSync = await readSyncState(client, 'ploomes_deals');
    const sinceStr = lastSync ? new Date(lastSync.getTime() - 10 * 60 * 1000).toISOString() : null;
    url = sinceStr
      ? `/Deals?$filter=PipelineId eq ${pipelineId} and LastUpdateDate ge ${sinceStr}&$expand=OtherProperties&$orderby=LastUpdateDate asc`
      : `/Deals?$filter=PipelineId eq ${pipelineId}&$expand=OtherProperties&$orderby=LastUpdateDate asc`;
  }

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
  if (next) {
    const nextUrl = next.startsWith('http') ? next : `${PLOOMES_BASE}${next}`;
    await client.from('ploomes_sync_state').upsert({ key: 'ploomes_deals_cursor', value: { next_url: nextUrl } }, { onConflict: 'key' });
    return { done: false, count: page.length };
  } else {
    await client.from('ploomes_sync_state').delete().eq('key', 'ploomes_deals_cursor');
    await writeSyncState(client, 'ploomes_deals', syncedAt);
    return { done: true, count: page.length };
  }
}

async function syncTasksPage(client) {
  const syncedAt = new Date().toISOString();
  const { data: stateRow } = await client.from('ploomes_sync_state').select('value').eq('key', 'ploomes_tasks_cursor').maybeSingle();
  const cursor = stateRow?.value?.next_url ?? null;

  let url;
  if (cursor) {
    url = cursor;
  } else {
    const lastSync = await readSyncState(client, 'ploomes_tasks');
    const sinceStr = lastSync ? new Date(lastSync.getTime() - 10 * 60 * 1000).toISOString() : null;
    url = sinceStr
      ? `/Tasks?$filter=DealId ne null and LastUpdateDate ge ${sinceStr}`
      : `/Tasks?$filter=DealId ne null`;
  }

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
  if (next) {
    const nextUrl = next.startsWith('http') ? next : `${PLOOMES_BASE}${next}`;
    await client.from('ploomes_sync_state').upsert({ key: 'ploomes_tasks_cursor', value: { next_url: nextUrl } }, { onConflict: 'key' });
    return { done: false, count: page.length };
  } else {
    await client.from('ploomes_sync_state').delete().eq('key', 'ploomes_tasks_cursor');
    await writeSyncState(client, 'ploomes_tasks', syncedAt);
    return { done: true, count: page.length };
  }
}

async function syncQuotesPage(client) {
  const syncedAt = new Date().toISOString();
  const { data: stateRow } = await client.from('ploomes_sync_state').select('value').eq('key', 'ploomes_quotes_cursor').maybeSingle();
  const cursor = stateRow?.value?.next_url ?? null;

  let url;
  if (cursor) {
    url = cursor;
  } else {
    const lastSync = await readSyncState(client, 'ploomes_quotes');
    const sinceStr = lastSync ? new Date(lastSync.getTime() - 10 * 60 * 1000).toISOString() : null;
    url = sinceStr
      ? `/Quotes?$filter=LastUpdateDate ge ${sinceStr}&$orderby=LastUpdateDate asc`
      : `/Quotes?$orderby=LastUpdateDate asc`;
  }

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
  if (next) {
    const nextUrl = next.startsWith('http') ? next : `${PLOOMES_BASE}${next}`;
    await client.from('ploomes_sync_state').upsert({ key: 'ploomes_quotes_cursor', value: { next_url: nextUrl } }, { onConflict: 'key' });
    return { done: false, count: page.length };
  } else {
    await client.from('ploomes_sync_state').delete().eq('key', 'ploomes_quotes_cursor');
    await writeSyncState(client, 'ploomes_quotes', syncedAt);
    return { done: true, count: page.length };
  }
}

export default async function handler(req, res) {
  if (!authCheck(req)) return res.status(401).json({ error: 'Unauthorized' });

  const step = req.query.step || 'refs';
  const client = getSupabase();

  try {
    if (step === 'refs') {
      const { pipelineId } = await syncRefs(client);
      return res.status(200).json({ ok: true, step: 'refs', pipelineId });
    }

    if (step === 'deals') {
      const { data: pipeRow } = await client.from('ploomes_pipelines').select('id').ilike('name', 'closer').maybeSingle();
      if (!pipeRow) return res.status(400).json({ error: 'Pipeline Closer não encontrado' });
      const result = await syncDealsPage(client, pipeRow.id);
      return res.status(200).json({ ok: true, step: 'deals', ...result });
    }

    if (step === 'tasks') {
      const result = await syncTasksPage(client);
      return res.status(200).json({ ok: true, step: 'tasks', ...result });
    }

    if (step === 'quotes') {
      const result = await syncQuotesPage(client);
      if (result.done) {
        await client.from('crm_dashboard_snapshots').delete().eq('key', 'default');
      }
      return res.status(200).json({ ok: true, step: 'quotes', ...result });
    }

    return res.status(400).json({ error: `Step desconhecido: ${step}` });
  } catch (err) {
    console.error(`[sync:${step}] Erro:`, err.message);
    return res.status(500).json({ error: err.message, step });
  }
}
