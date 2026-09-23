export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    await fetch('https://playmusictheory.net/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload
    });
  } catch (e) {
    // Upstream forwarding is optional; local client already echoes in localStorage
  }

  return res.status(200).setHeader('content-type', 'text/plain; charset=utf-8').send('thin');
}
