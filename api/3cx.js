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

    // Pega o metadata completo para achar o endpoint de call log
    const r = await fetch('https://cimerian.my3cx.com.br/xapi/v1/$metadata', {
      headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/xml' }
    });

    const text = await r.text();

    // Extrai todas as Functions e Actions disponíveis
    const functions = [...text.matchAll(/Function Name="([^"]+)"/g)].map(m => m[1]);
    const actions = [...text.matchAll(/Action Name="([^"]+)"/g)].map(m => m[1]);
    const entities = [...text.matchAll(/EntitySet Name="([^"]+)"/g)].map(m => m[1]);

    return res.status(200).json({ functions, actions, entities });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
