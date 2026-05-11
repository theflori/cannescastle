// deploy-marker confirm-interest-confirm-v1
// POST /api/confirm-interest/confirm
// Body: { id }
// Validates record is in Listed state with Source=Plus-One,
// then moves Messaging Status to "Semi Approved" (host must then manually approve).

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

    // Already moved on
    if (f['Messaging Status'] === 'Semi Approved') {
      return jsonOk({ alreadyExpressed: true });
    }
    if (f['Messaging Status'] === 'Approved') {
      return jsonOk({ alreadyApproved: true });
    }
    if (f['Messaging Status'] === 'Declined') {
      return jsonError('Invitation no longer valid', 409);
    }

    // Only Listed plus-ones can move to Semi Approved
    if (f['Messaging Status'] !== 'Listed' || f['Source'] !== 'Plus-One') {
      return jsonError('This link cannot be used here', 400);
    }

    await airtablePatch(env, recordId, {
      'Messaging Status': 'Semi Approved'
    });

    return jsonOk({ expressed: true });
  } catch (err) {
    return jsonError('Update failed: ' + err.message, 500);
  }
}
