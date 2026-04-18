export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const tokenRes = await fetch('https://cimerian.my3cx.com.br/connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: '8300',
        client_secret: process.env.SECRET_3CX
      })
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return res.status(500).json({ error: 'Falha ao autenticar no 3CX', detail: err });
    }

    const { access_token } = await tokenRes.json();

    const periodFrom = req.query.periodFrom || '2026-01-01T00:00:00Z';
    const periodTo   = req.query.periodTo   || new Date().toISOString();

    const url = `https://cimerian.my3cx.com.br/xapi/v1/ReportCallLogData/Pbx.GetCallLogData(periodFrom=${periodFrom},periodTo=${periodTo})`;

    const dataRes = await fetch(url, {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    if (!dataRes.ok) {
      const err = await dataRes.text();
      return res.status(500).json({ error: 'Falha ao buscar call log', detail: err });
    }

    const data = await dataRes.json();
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: 'Erro interno', detail: err.message });
  }
}
