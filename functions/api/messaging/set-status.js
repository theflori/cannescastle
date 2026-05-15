// deploy-marker 1778506899
// POST /api/messaging/set-status
// Body: { recordIds: string[], status: string }
//   status must be one of: "Listed" | "Semi Approved" | "Waitlist" | "Approved" | "Declined"
//   or "" (empty string) to remove from messaging

export async function onRequestPost(context) {
  const { request, env } = context;

  const required = ['AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_NAME'];
  for (const k of required) {
    if (!env[k]) return jsonError(`Missing env: ${k}`, 500);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const recordIds = Array.isArray(body.recordIds) ? body.recordIds.filter(x => typeof x === 'string') : [];
  if (recordIds.length === 0) return jsonError('Missing recordIds', 400);
  if (recordIds.length > 100) return jsonError('Too many records per batch (max 100)', 400);

  const status = (body.status === undefined || body.status === null) ? '' : String(body.status);
  const allowed = ['Listed', 'Semi Approved', 'Waitlist', 'Approved', 'Declined', ''];
  if (!allowed.includes(status)) {
    return jsonError(`Invalid status. Allowed: ${allowed.filter(s => s).join(', ')}, or empty to remove`, 400);
  }

  const baseUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}`;
  const headers = { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' };

  // Bulk PATCH (Airtable max 10 per call)
  let updated = 0;
  try {
    for (let i = 0; i < recordIds.length; i += 10) {
      const chunk = recordIds.slice(i, i + 10);
      const records = chunk.map(id => ({
        id,
        fields: { 'Messaging Status': status === '' ? null : status }
      }));
      const res = await fetch(baseUrl, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ records, typecast: true })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Airtable ${res.status}: ${text.substring(0, 200)}`);
      }
      updated += chunk.length;
    }
  } catch (err) {
    return jsonError('Airtable update failed: ' + err.message, 500);
  }

  return new Response(JSON.stringify({ ok: true, updated, status }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}
