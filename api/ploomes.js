export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, User-Key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { path, ...rest } = req.query;
  const queryString = new URLSearchParams(rest).toString();
  const url = `https://api2.ploomes.com/${path || ''}${queryString ? '?' + queryString : ''}`;

  try {
    const response = await fetch(url, {
      method: req.method,
      headers: {
        'User-Key': process.env.PLOOMES_USER_KEY,
        'Content-Type': 'application/json',
      },
      body: ['POST', 'PATCH'].includes(req.method) ? JSON.stringify(req.body) : undefined,
    });

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return res.status(response.status).json(data);
    }
    const text = await response.text();
    return res.status(response.status).send(text);
  } catch (err) {
    return res.status(500).json({ error: 'Proxy error', message: err.message });
  }
}
