// deploy-marker send-qr-bulk-v1
// POST /api/messaging/send-qr-to-guest
// Body: { recordId: string }              -> single guest
//       { recordIds: string[] }           -> bulk
//
// Sends the event-details + QR email (same template as 24h reminder)
// to one or many guests. Updates "QR Sent At".
//
// Status check: by default, only Approved guests receive the QR. Pass
// `force: true` in the body to override (e.g. send to a single test recipient).

import {
  airtableGet, airtablePatch,
  sendEmail, sendSms, normalizePhone,
  generateUniqueCode,
  markSendWarning, clearSendError,
  jsonError, jsonOk
} from '../../_lib/messaging-utils.js';
import { ensureQrCode } from '../../_lib/checkin-utils.js';
import { render24hReminderEmail, render24hReminderSms } from '../../_lib/templates.js';

function buildQrImageUrl(qrCode) {
  const payload = encodeURIComponent(qrCode);
  return `https://api.qrserver.com/v1/create-qr-code/?size=400x400&ecc=H&margin=10&data=${payload}`;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const required = ['AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_NAME', 'RESEND_API_KEY'];
  for (const k of required) {
    if (!env[k]) return jsonError(`Missing env: ${k}`, 500);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  // Accept either { recordId } (single) or { recordIds: [...] } (bulk)
  let recordIds = [];
  if (Array.isArray(body.recordIds)) {
    recordIds = body.recordIds.filter(x => typeof x === 'string');
  } else if (typeof body.recordId === 'string') {
    recordIds = [body.recordId];
  }

  if (recordIds.length === 0) return jsonError('Missing recordId(s)', 400);
  if (recordIds.length > 100) return jsonError('Too many records (max 100)', 400);

  const force = body.force === true;
  const isSingle = recordIds.length === 1 && !Array.isArray(body.recordIds);

  const results = {
    sent: 0, emailSent: 0, smsSent: 0,
    failed: [], skipped: [],
    // Legacy single-record shape kept for backwards compat with the existing
    // "sendQrSingle" handler in messaging.html — emailSent/smsSent at root.
    errors: []
  };

  for (const recordId of recordIds) {
    try {
      const record = await airtableGet(env, recordId);
      const f = record.fields || {};

      const email = (f['Email'] || '').trim();
      if (!email) {
        results.skipped.push({ id: recordId, reason: 'missing-email' });
        continue;
      }

      // Bulk send: only target Approved guests unless force=true
      if (!force && f['Messaging Status'] !== 'Approved') {
        results.skipped.push({
          id: recordId,
          reason: 'not-approved (status: ' + (f['Messaging Status'] || 'empty') + ')'
        });
        continue;
      }

      const name = f['Full Name'] || 'Guest';
      const phone = normalizePhone(f['Phone'] || '');

      let declineCode = f['Decline Code'];
      if (!declineCode) {
        declineCode = await generateUniqueCode(env, 'Decline Code');
      }

      const qrCode = await ensureQrCode(env, recordId);
      const qrCodeImageUrl = buildQrImageUrl(qrCode);

      let emailOk = false;
      try {
        const c = render24hReminderEmail({ name, declineCode, qrCodeImageUrl });
        await sendEmail(env, { to: email, subject: c.subject, html: c.html, text: c.text });
        emailOk = true;
        results.emailSent++;
      } catch (err) {
        console.error(`QR email failed for ${recordId}:`, err.message);
        results.failed.push({ id: recordId, channel: 'email', reason: err.message });
        results.errors.push({ channel: 'email', message: err.message });
      }

      let smsOk = false;
      if (phone && env.TWILIO_ACCOUNT_SID) {
        try {
          const smsBody = render24hReminderSms({ name, declineCode });
          await sendSms(env, { to: phone, body: smsBody });
          smsOk = true;
          results.smsSent++;
        } catch (err) {
          console.error(`QR SMS failed for ${recordId}:`, err.message);
          results.failed.push({ id: recordId, channel: 'sms', reason: err.message });
          results.errors.push({ channel: 'sms', message: err.message });
        }
      }

      // Update record
      const patch = { 'QR Sent At': new Date().toISOString() };
      if (!f['Decline Code']) patch['Decline Code'] = declineCode;
      await airtablePatch(env, recordId, patch);

      if (emailOk) {
        if (phone && env.TWILIO_ACCOUNT_SID && !smsOk) {
          await markSendWarning(env, recordId, 'QR SMS failed (email ok)');
        } else {
          await clearSendError(env, recordId);
        }
        results.sent++;
      }
    } catch (err) {
      console.error(`QR send failed for ${recordId}:`, err);
      results.failed.push({ id: recordId, channel: 'general', reason: err.message });
      results.errors.push({ channel: 'general', message: err.message });
    }
  }

  // For single-record callers, also expose flat booleans for compat
  if (isSingle) {
    return jsonOk({
      ...results,
      emailSent: results.emailSent > 0,
      smsSent: results.smsSent > 0
    });
  }

  return jsonOk(results);
}
