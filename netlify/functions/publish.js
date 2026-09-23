exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed'
    };
  }

  try {
    await fetch('https://playmusictheory.net/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: event.body
    });
  } catch (e) {
    // Upstream forwarding is optional; local client already echoes in localStorage
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: 'thin'
  };
};
