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

    const bases = [
      'https://cimerian.my3cx.com.br/xapi/v1/$metadata',
      'https://cimerian.my3cx.com.br/xapi/v1/',
      'https://cimerian.my3cx.com.br/xapi/',
      'https://cimerian.my3cx.com.br/api/v1/',
    ];

    const results = await Promise.all(bases.map(async (url) => {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' }
      });
      const text = await r.text();
      return { url, status: r.status, raw: text.substring(0, 800) };
    }));

    return res.status(200).json(results);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
