// deploy-marker 1778406072
// POST /api/decline/confirm
// Body: { id }
// Sets Messaging Status = Declined. Idempotent.

import { airtableGet, airtablePatch, jsonError, jsonOk } from '../../_lib/messaging-utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.AIRTABLE_TOKEN) return jsonError('Server misconfigured', 500);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const recordId = body.id;
  if (!recordId || !recordId.startsWith('rec')) return jsonError('Invalid id', 400);

  try {
    const record = await airtableGet(env, recordId);
    const f = record.fields || {};

    if (f['Messaging Status'] === 'Declined') {
      return jsonOk({ alreadyDeclined: true });
    }

    await airtablePatch(env, recordId, {
      'Messaging Status': 'Declined'
    });

    return jsonOk({ declined: true });
  } catch (err) {
    return jsonError('Decline failed: ' + err.message, 500);
  }
}
