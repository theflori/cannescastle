// deploy-marker 1778506899
// POST /api/messaging/send
// Body: { recordIds: string[] }
// Resends based on each record's current Messaging Status:
//   - Approved → Confirmation email + SMS
//   - Waitlist → Waitlist email + SMS
//   - Other → skipped
// Does NOT change status. Re-issues codes on every send.

import {
  airtableGet, airtablePatch,
  sendEmail, sendSms, normalizePhone,
  generateUniqueCode,
  markSendError, markSendWarning, clearSendError,
  jsonError, jsonOk
} from '../../_lib/messaging-utils.js';
import {
  renderConfirmationEmail, renderConfirmationSms,
  renderWaitlistEmail, renderWaitlistSms
} from '../../_lib/templates.js';

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

  const results = { sent: 0, emailSent: 0, smsSent: 0, failed: [], skipped: [] };

  for (const recordId of recordIds) {
    try {
      const record = await airtableGet(env, recordId);
      const f = record.fields || {};

      const messagingStatus = f['Messaging Status'] || '';
      const email = (f['Email'] || '').trim();
      const phone = normalizePhone(f['Phone'] || '');
      const name = f['Full Name'] || 'Guest';

      if (messagingStatus !== 'Approved' && messagingStatus !== 'Waitlist') {
        results.skipped.push({ id: recordId, reason: messagingStatus ? `no-template-for:${messagingStatus}` : 'no-status' });
        continue;
      }
      if (!email) {
        results.skipped.push({ id: recordId, reason: 'missing-email' });
        continue;
      }

      // Re-issue codes
      const declineCode = await generateUniqueCode(env, 'Decline Code');
      const plusOneCode = messagingStatus === 'Approved'
        ? await generateUniqueCode(env, 'Plus One Code')
        : null;

      let emailContent, smsBody;
      if (messagingStatus === 'Approved') {
        emailContent = renderConfirmationEmail({ name, declineCode, plusOneCode });
        smsBody = renderConfirmationSms({ name, declineCode });
      } else {
        emailContent = renderWaitlistEmail({ name, declineCode });
        smsBody = renderWaitlistSms({ name, declineCode });
      }

      let emailOk = false;
      try {
        await sendEmail(env, { to: email, subject: emailContent.subject, html: emailContent.html, text: emailContent.text });
        emailOk = true;
        results.emailSent++;
      } catch (err) {
        console.error(`Resend email failed for ${recordId}:`, err.message);
        results.failed.push({ id: recordId, channel: 'email', reason: err.message });
      }

      let smsOk = false;
      if (phone && env.TWILIO_ACCOUNT_SID) {
        try {
          await sendSms(env, { to: phone, body: smsBody });
          smsOk = true;
          results.smsSent++;
        } catch (err) {
          console.error(`Resend SMS failed for ${recordId}:`, err.message);
          results.failed.push({ id: recordId, channel: 'sms', reason: err.message });
        }
      }

      const updateFields = {
        'Decline Code': declineCode,
        'Last Message Sent At': new Date().toISOString()
      };
      if (plusOneCode) updateFields['Plus One Code'] = plusOneCode;

      await airtablePatch(env, recordId, updateFields);

      // Track outcome
      if (!emailOk) {
        await markSendError(env, recordId, 'Resend email failed: ' + (results.failed.find(x=>x.id===recordId && x.channel==='email')?.reason || 'unknown'));
      } else if (phone && env.TWILIO_ACCOUNT_SID && !smsOk) {
        await markSendWarning(env, recordId, 'SMS failed (email ok): ' + (results.failed.find(x=>x.id===recordId && x.channel==='sms')?.reason || 'unknown'));
      } else {
        await clearSendError(env, recordId);
      }

      if (emailOk || smsOk) results.sent++;
    } catch (err) {
      console.error(`Send failed for ${recordId}:`, err);
      results.failed.push({ id: recordId, channel: 'general', reason: err.message });
    }
  }

  return jsonOk(results);
}
