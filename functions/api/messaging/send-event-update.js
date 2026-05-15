// deploy-marker 1778506899
// POST /api/messaging/send-event-update
// Body: { recordIds?: string[] }  (optional - if missing, sends to ALL Approved)
//
// Sends Event Update email + SMS to approved guests.
// Updates "Last Event Update Sent At" field per record.
// Does NOT reveal the event address.

import {
  airtableGet, airtablePatch,
  sendEmail, sendSms, normalizePhone,
  generateUniqueCode,
  markSendError, markSendWarning, clearSendError,
  jsonError, jsonOk
} from '../../_lib/messaging-utils.js';
import { renderEventUpdateEmail, renderEventUpdateSms } from '../../_lib/templates.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const required = ['AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_NAME', 'RESEND_API_KEY'];
  for (const k of required) {
    if (!env[k]) return jsonError(`Missing env: ${k}`, 500);
  }

  let body;
  try { body = await request.json(); } catch { body = {}; }

  let recordIds = Array.isArray(body.recordIds) ? body.recordIds.filter(x => typeof x === 'string') : null;

  // If no recordIds provided, fetch all Approved records from Airtable
  if (!recordIds || recordIds.length === 0) {
    const formula = encodeURIComponent(`{Messaging Status}="Approved"`);
    const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}?filterByFormula=${formula}&pageSize=100`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` } });
    if (!res.ok) return jsonError('Could not list approved guests', 500);
    const data = await res.json();
    recordIds = (data.records || []).map(r => r.id);
  }

  if (recordIds.length === 0) return jsonError('No approved guests to notify', 400);
  if (recordIds.length > 250) return jsonError('Too many records (max 250)', 400);

  const results = {
    notified: 0, emailSent: 0, smsSent: 0,
    failed: [], skipped: []
  };

  for (const recordId of recordIds) {
    try {
      const record = await airtableGet(env, recordId);
      const f = record.fields || {};

      // Skip if not Approved
      if (f['Messaging Status'] !== 'Approved') {
        results.skipped.push({ id: recordId, reason: 'not-approved' });
        continue;
      }

      const email = (f['Email'] || '').trim();
      const phone = normalizePhone(f['Phone'] || '');
      const name = f['Full Name'] || 'Guest';

      if (!email) {
        results.skipped.push({ id: recordId, reason: 'missing-email' });
        continue;
      }

      // Reuse existing decline code, or generate a new one if missing
      let declineCode = f['Decline Code'];
      if (!declineCode) {
        declineCode = await generateUniqueCode(env, 'Decline Code');
      }

      // Email
      let emailOk = false;
      try {
        const c = renderEventUpdateEmail({ name, declineCode });
        await sendEmail(env, { to: email, subject: c.subject, html: c.html, text: c.text });
        emailOk = true;
        results.emailSent++;
      } catch (err) {
        console.error(`Event update email failed for ${recordId}:`, err.message);
        results.failed.push({ id: recordId, channel: 'email', reason: err.message });
      }

      // SMS
      let smsOk = false;
      if (phone && env.TWILIO_ACCOUNT_SID) {
        try {
          const smsBody = renderEventUpdateSms({ name, declineCode });
          await sendSms(env, { to: phone, body: smsBody });
          smsOk = true;
          results.smsSent++;
        } catch (err) {
          console.error(`Event update SMS failed for ${recordId}:`, err.message);
          results.failed.push({ id: recordId, channel: 'sms', reason: err.message });
        }
      }

      // Persist
      const updateFields = {
        'Last Event Update Sent At': new Date().toISOString()
      };
      if (!f['Decline Code']) updateFields['Decline Code'] = declineCode;
      await airtablePatch(env, recordId, updateFields);

      // Track outcome
      if (!emailOk) {
        await markSendError(env, recordId, 'Event update email failed: ' + (results.failed.find(x=>x.id===recordId && x.channel==='email')?.reason || 'unknown'));
      } else if (phone && env.TWILIO_ACCOUNT_SID && !smsOk) {
        await markSendWarning(env, recordId, 'SMS failed (email ok): ' + (results.failed.find(x=>x.id===recordId && x.channel==='sms')?.reason || 'unknown'));
      } else {
        await clearSendError(env, recordId);
      }

      if (emailOk || smsOk) results.notified++;
    } catch (err) {
      console.error(`Event update failed for ${recordId}:`, err);
      results.failed.push({ id: recordId, channel: 'general', reason: err.message });
    }
  }

  return jsonOk(results);
}
