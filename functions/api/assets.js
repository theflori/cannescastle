// deploy-marker 1778406072
// GET /api/assets — lists all uploaded brand assets from R2
//
// Requires R2 binding configured in Cloudflare Pages:
//   Settings → Functions → R2 bucket bindings → Variable name: ASSETS, Bucket: chateau-brand-assets

export async function onRequestGet(context) {
  const { env } = context;

  if (!env.ASSETS) {
    return jsonError('R2 storage not configured. See setup docs.', 500);
  }

  try {
    const list = await env.ASSETS.list({ prefix: 'assets/' });
    const assets = [];

    for (const obj of list.objects) {
      // Get custom metadata stored at upload-time
      const meta = obj.customMetadata || {};
      const id = obj.key.split('/').pop().split('.')[0]; // "assets/{uuid}.{ext}"

      assets.push({
        id,
        key: obj.key,
        name: meta.name || obj.key.split('/').pop(),
        category: meta.category || 'other',
        contentType: obj.httpMetadata?.contentType || meta.contentType || 'application/octet-stream',
        size: obj.size,
        uploadedAt: obj.uploaded,
        url: `/api/assets/file/${encodeURIComponent(obj.key)}`
      });
    }

    // Newest first
    assets.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    return new Response(JSON.stringify({ assets, total: assets.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (err) {
    return jsonError('R2 list failed: ' + err.message, 500);
  }
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
