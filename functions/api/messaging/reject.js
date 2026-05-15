// deploy-marker reject-v1
// POST /api/messaging/reject
// Body: { recordIds: string[] }
// For each Approved/Waitlist record:
//   1. Set Messaging Status = "Declined"
//   2. Send rejection email (apology, capacity reason)
//   3. Send rejection SMS (DE only — auto-send rule)
//   Intl: SMS skipped automatically by sendSms() unless INTL_SMS_BYPASS set

import {
  airtableGet, airtablePatch,
  sendEmail, sendSms, normalizePhone,
  markSendError, markSendWarning, clearSendError,
  jsonError, jsonOk
} from '../../_lib/messaging-utils.js';
import { renderRejectionEmail, renderRejectionSms } from '../../_lib/templates.js';

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

  const results = {
    rejected: 0, emailSent: 0, smsSent: 0,
    failed: [], skipped: []
  };

  for (const recordId of recordIds) {
    try {
      const record = await airtableGet(env, recordId);
      const f = record.fields || {};
      const currentStatus = f['Messaging Status'] || '';

      // Only reject Approved or Waitlist — sanity guard
      if (currentStatus !== 'Approved' && currentStatus !== 'Waitlist') {
        results.skipped.push({ id: recordId, reason: 'not-eligible (' + currentStatus + ')' });
        continue;
      }

      // Paid guests cannot be rejected
      if (f['Has Paid'] === true) {
        results.skipped.push({ id: recordId, reason: 'paid-guest-protected' });
        continue;
      }

      const email = (f['Email'] || '').trim();
      const phone = normalizePhone(f['Phone'] || '');
      const name = f['Full Name'] || 'Guest';

      if (!email) {
        results.skipped.push({ id: recordId, reason: 'missing-email' });
        continue;
      }

      // Send email
      let emailOk = false;
      try {
        const { subject, html, text } = renderRejectionEmail({ name });
        await sendEmail(env, { to: email, subject, html, text });
        emailOk = true;
        results.emailSent++;
      } catch (err) {
        console.error(`Reject email failed for ${recordId}:`, err.message);
        results.failed.push({ id: recordId, channel: 'email', reason: err.message });
      }

      // Send SMS (auto-skipped for non-DE)
      let smsSkippedIntl = false;
      if (phone && env.TWILIO_ACCOUNT_SID) {
        try {
          const smsBody = renderRejectionSms({ name });
          const smsResult = await sendSms(env, { to: phone, body: smsBody });
          if (smsResult && smsResult.skipped) {
            smsSkippedIntl = true;
          } else {
            results.smsSent++;
          }
        } catch (err) {
          console.error(`Reject SMS failed for ${recordId}:`, err.message);
          results.failed.push({ id: recordId, channel: 'sms', reason: err.message });
        }
      }

      // Update status to Declined regardless of channel results
      await airtablePatch(env, recordId, {
        'Messaging Status': 'Declined',
        'Status': 'Rejected',
        'Last Message Sent At': new Date().toISOString()
      });
      results.rejected++;

      // Error tracking
      if (!emailOk) {
        await markSendError(env, recordId, 'Rejection email failed');
      } else if (smsSkippedIntl) {
        // Email worked, SMS skipped on purpose for non-DE — clear any old errors, no warning needed
        await clearSendError(env, recordId);
      } else {
        await clearSendError(env, recordId);
      }
    } catch (err) {
      results.failed.push({ id: recordId, channel: 'record', reason: err.message });
    }
  }

  return jsonOk(results);
}
