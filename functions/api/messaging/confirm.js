// deploy-marker confirm-with-qr-v1
// POST /api/messaging/confirm
// Body: { recordIds: string[], sendQr?: boolean }
// For each record:
//   1. Generate 6-char Decline Code + Plus One Code
//   2. Save codes to Airtable + set Messaging Status = Approved
//   3. Send confirmation email + SMS (with short URLs)
//   4. Also send the event-details + QR email (default behavior unless sendQr=false)
//
// "sendQr" defaults to true — the dashboard's Confirm action now bundles QR.
// To suppress (e.g. manual flows where staff wants to send QR separately later),
// pass sendQr: false in the body.

import {
  airtableGet, airtablePatch,
  sendEmail, sendSms, normalizePhone,
  generateUniqueCode,
  markSendError, markSendWarning, clearSendError,
  jsonError, jsonOk
} from '../../_lib/messaging-utils.js';
import {
  renderConfirmationEmail, renderConfirmationSms,
  render24hReminderEmail
} from '../../_lib/templates.js';
import { ensureQrCode } from '../../_lib/checkin-utils.js';

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

  const recordIds = Array.isArray(body.recordIds) ? body.recordIds.filter(x => typeof x === 'string') : [];
  if (recordIds.length === 0) return jsonError('Missing recordIds', 400);
  if (recordIds.length > 100) return jsonError('Too many records per batch (max 100)', 400);

  // Default false — QR is sent via the separate "Confirm & send QR" action,
  // not bundled with the regular Confirm. Callers can opt-in by passing sendQr:true.
  const sendQr = body.sendQr === true;

  const results = {
    confirmed: 0, emailSent: 0, smsSent: 0, qrEmailSent: 0,
    failed: [], skipped: []
  };

  for (const recordId of recordIds) {
    try {
      const record = await airtableGet(env, recordId);
      const f = record.fields || {};

      const email = (f['Email'] || '').trim();
      const phone = normalizePhone(f['Phone'] || '');
      const name = f['Full Name'] || 'Guest';

      if (!email) {
        results.skipped.push({ id: recordId, reason: 'missing-email' });
        continue;
      }

      // Generate fresh codes (re-issue on every send, so old codes invalid)
      const declineCode = await generateUniqueCode(env, 'Decline Code');
      const plusOneCode = await generateUniqueCode(env, 'Plus One Code');

      // Send Confirmation Email
      let emailOk = false;
      try {
        const c = renderConfirmationEmail({ name, declineCode, plusOneCode });
        await sendEmail(env, { to: email, subject: c.subject, html: c.html, text: c.text });
        emailOk = true;
        results.emailSent++;
      } catch (err) {
        console.error(`Confirm email failed for ${recordId}:`, err.message);
        results.failed.push({ id: recordId, channel: 'email', reason: err.message });
      }

      // Send SMS
      let smsOk = false;
      if (phone && env.TWILIO_ACCOUNT_SID) {
        try {
          const smsBody = renderConfirmationSms({ name, declineCode });
          await sendSms(env, { to: phone, body: smsBody });
          smsOk = true;
          results.smsSent++;
        } catch (err) {
          console.error(`Confirm SMS failed for ${recordId}:`, err.message);
          results.failed.push({ id: recordId, channel: 'sms', reason: err.message });
        }
      }

      // Save codes + status + timestamp
      const patch = {
        'Messaging Status': 'Approved',
        'Status': 'Approved',
        'Decline Code': declineCode,
        'Plus One Code': plusOneCode,
        'Last Message Sent At': new Date().toISOString()
      };

      // Also send QR/event-details email if requested. Done after confirmation
      // so the inbox order makes sense: confirmation first, then access details.
      let qrEmailOk = false;
      if (sendQr) {
        try {
          const qrCode = await ensureQrCode(env, recordId);
          const qrCodeImageUrl = buildQrImageUrl(qrCode);
          const qrMail = render24hReminderEmail({ name, declineCode, qrCodeImageUrl });
          await sendEmail(env, { to: email, subject: qrMail.subject, html: qrMail.html, text: qrMail.text });
          qrEmailOk = true;
          results.qrEmailSent++;
          patch['QR Sent At'] = new Date().toISOString();
          patch['Status'] = 'Approved Ticket sent';
        } catch (err) {
          console.error(`QR email failed for ${recordId}:`, err.message);
          // Non-fatal — confirmation still went out, staff can manually resend QR
          results.failed.push({ id: recordId, channel: 'qr-email', reason: err.message });
        }
      }

      await airtablePatch(env, recordId, patch);

      // Track outcome on the guest record (visible in dashboard)
      if (!emailOk) {
        await markSendError(env, recordId, 'Confirm email failed: ' + (results.failed.find(x=>x.id===recordId && x.channel==='email')?.reason || 'unknown'));
      } else if (phone && env.TWILIO_ACCOUNT_SID && !smsOk) {
        await markSendWarning(env, recordId, 'SMS failed (email ok): ' + (results.failed.find(x=>x.id===recordId && x.channel==='sms')?.reason || 'unknown'));
      } else if (sendQr && !qrEmailOk) {
        await markSendWarning(env, recordId, 'QR email failed (confirm ok): ' + (results.failed.find(x=>x.id===recordId && x.channel==='qr-email')?.reason || 'unknown'));
      } else {
        await clearSendError(env, recordId);
      }

      if (emailOk || smsOk) results.confirmed++;
    } catch (err) {
      console.error(`Confirm failed for ${recordId}:`, err);
      results.failed.push({ id: recordId, channel: 'general', reason: err.message });
    }
  }

  return jsonOk(results);
}
