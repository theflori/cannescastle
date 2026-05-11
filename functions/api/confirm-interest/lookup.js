// deploy-marker confirm-interest-lookup-v1
// GET /api/confirm-interest/lookup?id={recordId}
// Returns name + primary name + current status

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

    // Resolve primary's name via Plus One Of link
    let primaryName = '';
    const plusOneOf = f['Plus One Of'];
    if (Array.isArray(plusOneOf) && plusOneOf.length > 0) {
      try {
        const primary = await airtableGet(env, plusOneOf[0]);
        primaryName = primary.fields?.['Full Name'] || '';
      } catch {
        // If primary lookup fails, leave empty
      }
    }

    const messagingStatus = f['Messaging Status'] || '';

    return jsonOk({
      name: f['Full Name'] || '',
      primaryName,
      messagingStatus,
      alreadyExpressed: messagingStatus !== 'Listed',
      isDeclined: messagingStatus === 'Declined',
      isApproved: messagingStatus === 'Approved'
    });
  } catch (err) {
    return jsonError('Lookup failed', 500);
  }
}
