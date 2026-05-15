// deploy-marker 1778406072
// POST /api/update-record
// Body: { recordId, fields: { ... } }
// Generic single-record update. Used for Status, Tags, Internal Notes, etc.
// Whitelist of editable fields keeps this endpoint safe.

const ALLOWED_FIELDS = new Set([
  'Status',
  'Tags',
  'Internal Notes',
  'Importance',
  'Instagram'  // re-included so this could replace update-instagram.js if you want
]);

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

  const { recordId, fields } = body;
  if (!recordId || typeof recordId !== 'string') {
    return jsonError('Missing recordId', 400);
  }
  if (!fields || typeof fields !== 'object') {
    return jsonError('Missing fields', 400);
  }

  // Filter to allowed fields only
  const safeFields = {};
  for (const k of Object.keys(fields)) {
    if (ALLOWED_FIELDS.has(k)) {
      safeFields[k] = fields[k];
    }
  }
  if (Object.keys(safeFields).length === 0) {
    return jsonError('No editable fields provided', 400);
  }

  // Special case: when Instagram is updated, clear stale IG data
  if ('Instagram' in safeFields) {
    safeFields['IG Followers'] = null;
    safeFields['IG Avatar URL'] = '';
    safeFields['IG Last Refresh'] = null;
  }

  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}/${recordId}`;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: safeFields, typecast: true })
    });

    if (!res.ok) {
      const text = await res.text();
      return jsonError(`Airtable ${res.status}: ${text.substring(0, 300)}`, res.status);
    }

    const data = await res.json();
    return new Response(JSON.stringify({
      ok: true,
      record: { id: data.id, fields: data.fields }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return jsonError('Update failed: ' + err.message, 500);
  }
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
