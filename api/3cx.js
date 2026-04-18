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

    const { access_token } = await tokenRes.json();

    const periodFrom = req.query.periodFrom || '2026-02-01T00:00:00Z';
    const periodTo   = req.query.periodTo   || '2026-04-18T23:59:59Z';

    const url = `https://cimerian.my3cx.com.br/xapi/v1/CallLogData/Pbx.GetCallLogData(periodFrom=${periodFrom},periodTo=${periodTo})`;

    const dataRes = await fetch(url, {
      headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' }
    });

    const statusCode = dataRes.status;
    const raw = await dataRes.text();

    return res.status(200).json({ statusCode, url, raw: raw.substring(0, 3000) });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
