// deploy-marker 1778400849
// GET /api/plus-one/lookup?token=...

import { verifyToken, airtableGet, jsonError, jsonOk } from '../../_lib/messaging-utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.SESSION_SECRET || !env.AIRTABLE_TOKEN) {
    return jsonError('Server misconfigured', 500);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return jsonError('Missing token', 400);

  const payload = await verifyToken(token, env.SESSION_SECRET, 'plusone');
  if (!payload || !payload.rid) return jsonError('Invalid token', 403);

  try {
    const record = await airtableGet(env, payload.rid);
    const f = record.fields || {};

    const storedToken = f['Plus One Token'] || '';
    if (storedToken && storedToken !== token) {
      return jsonError('Token superseded', 403);
    }

    const alreadyUsed = !!f['Plus One Used'];
    const plusOneName = '';  // Could fetch the linked record's name, but keep it simple

    return jsonOk({
      primaryName: f['Full Name'] || '',
      alreadyUsed,
      plusOneName
    });
  } catch (err) {
    return jsonError('Lookup failed: ' + err.message, 500);
  }
}
