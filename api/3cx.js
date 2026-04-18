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

    const r = await fetch('https://cimerian.my3cx.com.br/xapi/v1/$metadata', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const text = await r.text();

    // Extrai o bloco completo da função GetCallLogData
    const match = text.match(/Function Name="GetCallLogData"[\s\S]{0,800}/);
    const matchAction = text.match(/Action Name="GetCallLogData"[\s\S]{0,800}/);

    return res.status(200).json({ 
      function: match ? match[0] : 'não encontrado',
      action: matchAction ? matchAction[0] : 'não encontrado'
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
