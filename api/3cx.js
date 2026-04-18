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
    const h = { Authorization: `Bearer ${access_token}`, Accept: 'application/json', 'Content-Type': 'application/json' };

    const urls = [
      // POST sem parâmetros na URL, params no body
      { url: `https://cimerian.my3cx.com.br/xapi/v1/CallLogData/Pbx.GetCallLogData`, body: { periodFrom: '2026-02-01T00:00:00Z', periodTo: '2026-04-18T23:59:59Z' } },
      // POST sem parâmetros na URL, params no body com aspas
      { url: `https://cimerian.my3cx.com.br/xapi/v1/CallLogData/Pbx.GetCallLogData`, body: { periodFrom: "'2026-02-01T00:00:00Z'", periodTo: "'2026-04-18T23:59:59Z'" } },
      // POST com datas no formato diferente
      { url: `https://cimerian.my3cx.com.br/xapi/v1/CallLogData/Pbx.GetCallLogData`, body: { periodFrom: '2026-02-01', periodTo: '2026-04-18' } },
    ];

    const results = await Promise.all(urls.map(async ({ url, body }) => {
      const r = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body) });
      const text = await r.text();
      return { status: r.status, body, raw: text.substring(0, 500) };
    }));

    return res.status(200).json(results);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
