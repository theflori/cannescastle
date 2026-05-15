// deploy-marker 1778406072
// POST /api/update-bulk
// Body: { recordIds: string[], fields: { ... } }
// Updates the same fields on multiple records at once.

const ALLOWED_FIELDS = new Set([
  'Status',
  'Tags',
  'Importance'
]);

export async function onRequestPost(context) {
  const { request, env } = context;

  for (const k of ['AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_NAME']) {
    if (!env[k]) return jsonError(`Missing env: ${k}`, 500);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const { recordIds, fields } = body;
  if (!Array.isArray(recordIds) || recordIds.length === 0) {
    return jsonError('Missing recordIds', 400);
  }
  if (!fields || typeof fields !== 'object') {
    return jsonError('Missing fields', 400);
  }

  const safeFields = {};
  for (const k of Object.keys(fields)) {
    if (ALLOWED_FIELDS.has(k)) safeFields[k] = fields[k];
  }
  if (Object.keys(safeFields).length === 0) {
    return jsonError('No editable fields provided', 400);
  }

  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}`;
  let updated = 0;

  try {
    // Airtable PATCH allows max 10 records per call
    for (let i = 0; i < recordIds.length; i += 10) {
      const chunk = recordIds.slice(i, i + 10);
      const records = chunk.map(id => ({ id, fields: safeFields }));

      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ records, typecast: true })
      });

      if (!res.ok) {
        const text = await res.text();
        return jsonError(`Airtable ${res.status}: ${text.substring(0, 300)}`, res.status);
      }
      updated += chunk.length;
    }
  } catch (err) {
    return jsonError('Bulk update failed: ' + err.message, 500);
  }

  return new Response(JSON.stringify({ ok: true, updated }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
