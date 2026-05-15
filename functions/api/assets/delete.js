// deploy-marker 1778406072
// POST /api/assets/delete
// Body: { id }  or  { key }

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ASSETS) return jsonError('R2 storage not configured', 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  let { id, key } = body;

  // Resolve id → key by listing
  if (!key && id) {
    const list = await env.ASSETS.list({ prefix: 'assets/' });
    const found = list.objects.find(o => {
      const fileId = o.key.split('/').pop().split('.')[0];
      return fileId === id;
    });
    if (!found) return jsonError('Asset not found', 404);
    key = found.key;
  }

  if (!key) return jsonError('Missing id or key', 400);

  try {
    await env.ASSETS.delete(key);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return jsonError('Delete failed: ' + err.message, 500);
  }
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
