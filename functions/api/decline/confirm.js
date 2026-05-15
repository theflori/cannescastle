// deploy-marker 1778400849
// POST /api/decline/confirm
// Body: { token }
// Validates token, sets Messaging Status = Declined.

import { verifyToken, airtableGet, airtablePatch, jsonError, jsonOk } from '../../_lib/messaging-utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SESSION_SECRET || !env.AIRTABLE_TOKEN) {
    return jsonError('Server misconfigured', 500);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const token = body.token;
  if (!token) return jsonError('Missing token', 400);

  const payload = await verifyToken(token, env.SESSION_SECRET, 'decline');
  if (!payload || !payload.rid) return jsonError('Invalid token', 403);

  try {
    // Validate against stored token (single-issuance defense)
    const record = await airtableGet(env, payload.rid);
    const f = record.fields || {};
    const storedToken = f['Decline Token'] || '';
    if (storedToken && storedToken !== token) {
      return jsonError('Token superseded', 403);
    }

    // Idempotent: if already declined, return success
    if (f['Messaging Status'] === 'Declined') {
      return jsonOk({ alreadyDeclined: true });
    }

    await airtablePatch(env, payload.rid, {
      'Messaging Status': 'Declined'
    });

    return jsonOk({ declined: true });
  } catch (err) {
    return jsonError('Decline failed: ' + err.message, 500);
  }
}
