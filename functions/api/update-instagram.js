// deploy-marker 1778406072
// POST /api/update-instagram
// Body: { recordId, instagram }
// Updates the Instagram field for a single Airtable record.
// Used for inline-editing handles that Apify couldn't find.

export async function onRequestPost(context) {
  const { request, env } = context;

  const required = ['AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_NAME'];
  for (const k of required) {
    if (!env[k]) return jsonError(`Missing env: ${k}`, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const { recordId, instagram } = body;
  if (!recordId || typeof recordId !== 'string') {
    return jsonError('Missing recordId', 400);
  }
  if (typeof instagram !== 'string') {
    return jsonError('Missing instagram', 400);
  }

  // Normalize the handle the same way the rest of the system does
  const normalized = normalizeHandle(instagram);
  if (!normalized || normalized.length < 1 || normalized.length > 30) {
    return jsonError('Invalid Instagram handle', 400);
  }

  // Update Airtable
  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}/${recordId}`;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          'Instagram': normalized,
          // Clear stale data when handle changes — they'll be repopulated
          // on next refresh
          'IG Followers': null,
          'IG Avatar URL': '',
          'IG Last Refresh': null
        }
      })
    });

    if (!res.ok) {
      const text = await res.text();
      return jsonError(`Airtable ${res.status}: ${text.substring(0, 200)}`, 500);
    }

    const data = await res.json();
    return new Response(JSON.stringify({
      ok: true,
      record: {
        id: data.id,
        instagram: data.fields?.['Instagram'] || normalized
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return jsonError('Airtable update failed: ' + err.message, 500);
  }
}

function normalizeHandle(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, '')
    .replace(/\/$/, '')
    .replace(/\?.*$/, '')
    .trim();
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
