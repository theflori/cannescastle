// deploy-marker 1778311050
// GET /api/assets/file/{key}
// Streams the file from R2 to the browser
// Used for display in <img>, downloads, modal previews

export async function onRequestGet(context) {
  const { params, env } = context;

  if (!env.ASSETS) return new Response('R2 not configured', { status: 500 });

  const key = Array.isArray(params.path) ? params.path.join('/') : params.path;
  if (!key) return new Response('Missing key', { status: 400 });

  // Security: only serve files from the assets/ prefix
  if (!key.startsWith('assets/')) return new Response('Forbidden', { status: 403 });

  try {
    const obj = await env.ASSETS.get(key);
    if (!obj) return new Response('Not found', { status: 404 });

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('etag', obj.httpEtag);
    headers.set('Cache-Control', 'public, max-age=3600');

    return new Response(obj.body, { status: 200, headers });
  } catch (err) {
    return new Response('Error: ' + err.message, { status: 500 });
  }
}
