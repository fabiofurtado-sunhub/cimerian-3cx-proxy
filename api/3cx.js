export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

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
    const h = { Authorization: `Bearer ${access_token}`, Accept: 'application/json' };

    const urls = [
      `https://cimerian.my3cx.com.br/xapi/v1/CallLogData/Pbx.GetCallLogData(periodFrom=2026-02-01T00:00:00Z,periodTo=2026-04-18T23:59:59Z)`,
      `https://cimerian.my3cx.com.br/xapi/v1/ReportCallLogData/Pbx.GetCallLogData(periodFrom=2026-02-01T00:00:00Z,periodTo=2026-04-18T23:59:59Z)`,
      `https://cimerian.my3cx.com.br/xapi/v1/Pbx.GetCallLogData(periodFrom=2026-02-01T00:00:00Z,periodTo=2026-04-18T23:59:59Z)`,
      `https://cimerian.my3cx.com.br/xapi/v1/CallLogData?$filter=StartTime ge 2026-02-01T00:00:00Z`,
      `https://cimerian.my3cx.com.br/xapi/v1/CallLogData`,
    ];

    const results = await Promise.all(urls.map(async (url) => {
      const r = await fetch(url, { headers: h });
      const text = await r.text();
      return { status: r.status, url, raw: text.substring(0, 300) };
    }));

    return res.status(200).json(results);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
