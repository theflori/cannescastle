// deploy-marker 1778506899
// POST /api/messaging/add
// Body: { recordIds: string[] }
// For each record:
//   - if "Messaging Status" is empty → set to "Listed"
//   - if already set (Listed/Semi Approved/etc.) → SKIP, leave as-is
// Response: { added: number, skipped: number, skippedDetails: [{id, currentStatus}] }

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
  if (recordIds.length === 0) return jsonError('Missing recordIds (array)', 400);
  if (recordIds.length > 100) return jsonError('Too many records at once (max 100)', 400);

  const baseUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}`;
  const headers = { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' };

  // 1) Fetch each record's current Messaging Status to decide skip vs add
  let toAdd = [];
  let skipped = [];
  try {
    // Airtable doesn't have batch GET; fetch individually.
    // For up to 50 records this is fine; <250ms each.
    for (const id of recordIds) {
      const res = await fetch(`${baseUrl}/${id}`, { headers });
      if (!res.ok) {
        if (res.status === 404) {
          skipped.push({ id, reason: 'record-not-found' });
          continue;
        }
        const text = await res.text();
        throw new Error(`Airtable ${res.status}: ${text.substring(0, 200)}`);
      }
      const data = await res.json();
      const current = data.fields?.['Messaging Status'] || '';
      if (current) {
        skipped.push({ id, reason: 'already-in-messaging', currentStatus: current });
      } else {
        toAdd.push(id);
      }
    }
  } catch (err) {
    return jsonError('Airtable read failed: ' + err.message, 500);
  }

  if (toAdd.length === 0) {
    return new Response(JSON.stringify({
      ok: true, added: 0, skipped: skipped.length, skippedDetails: skipped
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  // 2) Bulk PATCH the ones to add (Airtable max 10 per call)
  let added = 0;
  try {
    for (let i = 0; i < toAdd.length; i += 10) {
      const chunk = toAdd.slice(i, i + 10);
      const records = chunk.map(id => ({
        id,
        fields: { 'Messaging Status': 'Listed' }
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
      added += chunk.length;
    }
  } catch (err) {
    return jsonError('Airtable update failed: ' + err.message, 500);
  }

  return new Response(JSON.stringify({
    ok: true, added, skipped: skipped.length, skippedDetails: skipped
  }), { headers: { 'Content-Type': 'application/json' } });
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}
