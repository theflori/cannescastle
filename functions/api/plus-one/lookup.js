// deploy-marker 1778406072
// GET /api/plus-one/lookup?id={recordId}

import { airtableGet, jsonError, jsonOk } from '../../_lib/messaging-utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.AIRTABLE_TOKEN) return jsonError('Server misconfigured', 500);

  const url = new URL(request.url);
  const recordId = url.searchParams.get('id');
  if (!recordId || !recordId.startsWith('rec')) return jsonError('Invalid id', 400);

  try {
    const record = await airtableGet(env, recordId);
    const f = record.fields || {};

    return jsonOk({
      primaryName: f['Full Name'] || '',
      alreadyUsed: !!f['Plus One Used']
    });
  } catch (err) {
    return jsonError('Lookup failed', 500);
  }
}
