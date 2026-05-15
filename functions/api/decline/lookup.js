// deploy-marker 1778400849
// GET /api/decline/lookup?token=...
// Validates token. Returns the guest's name + whether already declined.
// Does NOT change any state.

import { verifyToken, airtableGet, jsonError, jsonOk } from '../../_lib/messaging-utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.SESSION_SECRET || !env.AIRTABLE_TOKEN) {
    return jsonError('Server misconfigured', 500);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return jsonError('Missing token', 400);

  const payload = await verifyToken(token, env.SESSION_SECRET, 'decline');
  if (!payload || !payload.rid) return jsonError('Invalid token', 403);

  try {
    const record = await airtableGet(env, payload.rid);
    const f = record.fields || {};

    // Verify token matches the one stored on the record (defense-in-depth)
    const storedToken = f['Decline Token'] || '';
    if (storedToken && storedToken !== token) {
      // Stored token differs - probably user got a newer email and old token leaked
      // Allow only if we can't verify (graceful fallback)
      return jsonError('Token superseded', 403);
    }

    return jsonOk({
      name: f['Full Name'] || '',
      alreadyDeclined: f['Messaging Status'] === 'Declined'
    });
  } catch (err) {
    return jsonError('Lookup failed: ' + err.message, 500);
  }
}
