// deploy-marker add-alist-v2
// POST /api/guests/add-alist
// Body: { name: string, allowance?: '0'|'1'|'2'|'3'|'unlimited' }
// Creates new Airtable record tagged "A-List" with the given Plus One Allowance.
// No email, no instagram — just name + allowance. Email/phone can be added manually later.

import { jsonError, jsonOk } from '../../_lib/messaging-utils.js';

const VALID_ALLOWANCE = new Set(['0', '1', '2', '3', 'unlimited']);

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID || !env.AIRTABLE_TABLE_NAME) {
    return jsonError('Missing Airtable env', 500);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const name = (body.name || '').trim();
  if (!name || name.length < 2) return jsonError('name required (min 2 chars)', 400);

  let allowance = String(body.allowance || '0').toLowerCase();
  if (allowance === 'open' || allowance === '*' || allowance === 'all') allowance = 'unlimited';
  if (!VALID_ALLOWANCE.has(allowance)) {
    return jsonError('allowance must be 0, 1, 2, 3, or unlimited', 400);
  }

  const fields = {
    'Full Name': name,
    'Tags': ['A-List'],
    'Plus One Allowance': allowance,
    'Source': 'Manual A-List',
    'Status': 'Approved',
    'Messaging Status': 'Approved'
  };

  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.AIRTABLE_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields, typecast: true })
  });
  const data = await res.json();
  if (!res.ok) {
    // Return the FULL Airtable error so the frontend can show useful details
    const errMsg = data.error?.message || data.error?.type || JSON.stringify(data.error || data);
    console.error('[add-alist] Airtable rejected:', name, '-', errMsg, '| fields:', JSON.stringify(fields));
    return jsonError('Airtable: ' + errMsg, 500);
  }

  return jsonOk({ id: data.id, fields: data.fields });
}
