// deploy-marker 1778406072
// POST /api/assets/upload
// multipart/form-data:
//   - file: the binary file
//   - name: original filename
//   - category: logo|sponsor|brand|photo|other
//
// Writes file to R2 bucket. Auth is handled by _middleware.js (cookie-based).

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ASSETS) return jsonError('R2 storage not configured. See setup docs.', 500);

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError('Expected multipart/form-data', 400);
  }

  const file = formData.get('file');
  const name = formData.get('name') || (file && file.name) || 'unnamed';
  const category = (formData.get('category') || 'other').toString();

  if (!file || typeof file === 'string') {
    return jsonError('Missing file', 400);
  }

  if (file.size > 10 * 1024 * 1024) {
    return jsonError('File exceeds 10MB limit', 400);
  }
  if (file.size === 0) {
    return jsonError('Empty file', 400);
  }

  const allowedCats = ['logo', 'sponsor', 'brand', 'photo', 'other'];
  const safeCategory = allowedCats.includes(category) ? category : 'other';

  // Generate unique key
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase().substring(0, 8) : '';
  const id = crypto.randomUUID();
  const key = `assets/${id}${ext ? '.' + ext : ''}`;

  try {
    await env.ASSETS.put(key, file.stream(), {
      httpMetadata: {
        contentType: file.type || 'application/octet-stream'
      },
      customMetadata: {
        name: name.toString().substring(0, 200),
        category: safeCategory,
        contentType: file.type || 'application/octet-stream',
        uploadedAt: new Date().toISOString()
      }
    });

    return new Response(JSON.stringify({
      ok: true,
      asset: {
        id,
        key,
        name,
        category: safeCategory,
        contentType: file.type,
        size: file.size,
        url: `/api/assets/file/${encodeURIComponent(key)}`
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return jsonError('Upload to R2 failed: ' + err.message, 500);
  }
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
