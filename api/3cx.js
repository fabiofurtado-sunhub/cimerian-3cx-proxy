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

    // Testa 3 formatos diferentes em paralelo
    const bases = [
      `https://cimerian.my3cx.com.br/xapi/v1/ReportCallLogData/Pbx.GetCallLogData(periodFrom=2026-02-01T00:00:00Z,periodTo=2026-04-18T23:59:59Z)`,
      `https://cimerian.my3cx.com.br/xapi/v1/ReportCallLogData/Pbx.GetCallLogData?periodFrom=2026-02-01T00:00:00Z&periodTo=2026-04-18T23:59:59Z`,
      `https://cimerian.my3cx.com.br/xapi/v1/ReportCallLogData`
    ];

    const results = await Promise.all(bases.map(async (url) => {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' }
      });
      const text = await r.text();
      return { url, status: r.status, raw: text.substring(0, 500) };
    }));

    return res.status(200).json(results);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
