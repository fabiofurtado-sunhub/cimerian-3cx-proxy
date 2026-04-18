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

    const url = `https://cimerian.my3cx.com.br/xapi/v1/CallLogData/Pbx.GetCallLogData`;

    const body = {
      periodFrom: '2026-02-01T00:00:00Z',
      periodTo: '2026-04-18T23:59:59Z',
      sourceType: 0,
      sourceFilter: '',
      destinationType: 0,
      destinationFilter: '',
      callsType: 0,
      callTimeFilterType: 0,
      callTimeFilterFrom: '',
      callTimeFilterTo: '',
      hidePcalls: false
    };

    const dataRes = await fetch(url, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${access_token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const statusCode = dataRes.status;
    const allow = dataRes.headers.get('Allow') || '';
    const raw = await dataRes.text();

    return res.status(200).json({ statusCode, allow, url, raw: raw.substring(0, 3000) });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
