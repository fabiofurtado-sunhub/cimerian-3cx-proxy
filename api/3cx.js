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
    const url = `https://cimerian.my3cx.com.br/xapi/v1/CallLogData/Pbx.GetCallLogData(periodFrom=2026-02-01T00:00:00Z,periodTo=2026-04-18T23:59:59Z)`;
    const h = { Authorization: `Bearer ${access_token}`, Accept: 'application/json', 'Content-Type': 'application/json' };

    const methods = ['GET', 'POST', 'PUT', 'PATCH'];

    const results = await Promise.all(methods.map(async (method) => {
      const opts = { method, headers: h };
      if (method !== 'GET') opts.body = JSON.stringify({});
      const r = await fetch(url, opts);
      const allow = r.headers.get('Allow') || r.headers.get('allow') || '';
      const text = await r.text();
      return { method, status: r.status, allow, raw: text.substring(0, 300) };
    }));

    return res.status(200).json(results);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
