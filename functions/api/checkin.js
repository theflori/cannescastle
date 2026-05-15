// deploy-marker checkin-v1
// POST /api/checkin
// Body: { qr: string }
//
// Validates a QR code and marks the guest as checked in.
//
// Returns 200 with structured result:
//   { result: 'valid', guest: {...} }                 -> first check-in, mark green
//   { result: 'already_checked_in', guest: {...} }    -> mark yellow
//   { result: 'invalid', reason: 'not-found' }        -> mark red
//   { result: 'invalid', reason: 'not-approved' }     -> mark red
//
// Important: this endpoint requires staff auth via session cookie.
// The scanner app authenticates separately with STAFF_PASSWORD and
// receives a normal cp_session cookie that the middleware accepts.

import { findGuestByQr, checkInGuest, jsonError, jsonOk } from '../_lib/checkin-utils.js';

export async function onRequestPost(context) {
  try {
    return await handleCheckin(context);
  } catch (err) {
    console.error('[checkin] uncaught:', err && err.message, '\n', err && err.stack);
    return new Response(
      JSON.stringify({ result: 'error', reason: (err && err.message) || String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function handleCheckin(context) {
  const { request, env } = context;

  const required = ['AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_NAME'];
  for (const k of required) {
    if (!env[k]) return jsonError(`Missing env: ${k}`, 500);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const qr = (body.qr || '').trim();
  if (!qr) return jsonError('Missing qr', 400);

  const record = await findGuestByQr(env, qr);
  if (!record) {
    return new Response(JSON.stringify({
      result: 'invalid',
      reason: 'not-found',
      qr
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const f = record.fields || {};

  // Only "Approved" guests (i.e. confirmed attendees) can check in.
  // Waitlist / Declined / empty status are rejected.
  if (f['Messaging Status'] !== 'Approved') {
    return new Response(JSON.stringify({
      result: 'invalid',
      reason: 'not-approved',
      status: f['Messaging Status'] || '(empty)',
      guest: {
        name: f['Full Name'] || '',
        instagram: f['Instagram'] || ''
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const wasAlreadyCheckedIn = f['Checked In'] === true;
  const updated = await checkInGuest(env, record);

  return jsonOk({
    result: wasAlreadyCheckedIn ? 'already_checked_in' : 'valid',
    guest: updated
  });
}
