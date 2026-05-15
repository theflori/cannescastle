// deploy-marker checkin-stats-v1
// GET /api/checkin-stats
// Returns counts of approved guests and how many are checked in.
// Used by the scanner top-bar to show "127 / 200".

import { jsonError, jsonOk } from '../_lib/messaging-utils.js';

export async function onRequestGet(context) {
  try {
    return await handleStats(context);
  } catch (err) {
    console.error('[checkin-stats] uncaught:', err && err.message);
    return new Response(JSON.stringify({ error: 'stats-failed', message: (err && err.message) || String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handleStats(context) {
  const { env } = context;
  const required = ['AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_NAME'];
  for (const k of required) {
    if (!env[k]) return jsonError(`Missing env: ${k}`, 500);
  }

  // Count approved guests
  const approvedFormula = encodeURIComponent(`{Messaging Status}="Approved"`);
  const checkedInFormula = encodeURIComponent(`AND({Messaging Status}="Approved", {Checked In}=TRUE())`);

  const baseUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}`;
  const auth = { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` };

  const approved = await countAll(`${baseUrl}?filterByFormula=${approvedFormula}&fields[]=Full Name`, auth);
  const checkedIn = await countAll(`${baseUrl}?filterByFormula=${checkedInFormula}&fields[]=Full Name`, auth);

  return jsonOk({ approved, checkedIn });
}

async function countAll(url, headers) {
  let count = 0;
  let next = url;
  let safety = 10; // max ~1000 records
  while (next && safety-- > 0) {
    const res = await fetch(next, { headers });
    if (!res.ok) throw new Error(`Airtable ${res.status}`);
    const data = await res.json();
    count += (data.records || []).length;
    if (data.offset) {
      const sep = next.includes('?') ? '&' : '?';
      next = url + (url.includes('?') ? '&' : '?') + 'offset=' + encodeURIComponent(data.offset);
    } else {
      next = null;
    }
  }
  return count;
}
