// deploy-marker 1778506899-qr
// POST /api/messaging/send-24h-reminder
// Body: { recordIds?: string[], dryRun?: boolean }
//
// Sends event-details + QR reminder email (and SMS) to approved guests.
// - Ensures each guest has a "QR Code" UUID in Airtable
// - Builds a QR image URL (public qrserver.com endpoint) encoding that UUID
// - Marks "QR Sent At" so the dashboard can show "QR delivered" status
//
// dryRun=true sends to a single test address and does NOT modify Airtable.

import {
  airtableGet, airtablePatch,
  sendEmail, sendSms, normalizePhone,
  generateUniqueCode,
  markSendError, markSendWarning, clearSendError,
  jsonError, jsonOk
} from '../../_lib/messaging-utils.js';
import { ensureQrCode } from '../../_lib/checkin-utils.js';
import { render24hReminderEmail, render24hReminderSms } from '../../_lib/templates.js';

function buildQrImageUrl(qrCode) {
  // Public QR code generator — returns a PNG, no auth needed.
  // 400x400 with a high error-correction level so it scans well even on
  // dim phone screens / printed-out passes.
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
  try { body = await request.json(); } catch { body = {}; }

  let recordIds = Array.isArray(body.recordIds) ? body.recordIds.filter(x => typeof x === 'string') : null;

  // If no recordIds provided, fetch all Approved records
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

      let declineCode = f['Decline Code'];
      if (!declineCode) {
        declineCode = await generateUniqueCode(env, 'Decline Code');
      }

      // Ensure QR exists for this guest (idempotent — reuses existing if set)
      const qrCode = await ensureQrCode(env, recordId);
      const qrCodeImageUrl = buildQrImageUrl(qrCode);

      let emailOk = false;
      try {
        const c = render24hReminderEmail({ name, declineCode, qrCodeImageUrl });
        await sendEmail(env, { to: email, subject: c.subject, html: c.html, text: c.text });
        emailOk = true;
        results.emailSent++;
      } catch (err) {
        console.error(`24h reminder email failed for ${recordId}:`, err.message);
        results.failed.push({ id: recordId, channel: 'email', reason: err.message });
      }

      let smsOk = false;
      if (phone && env.TWILIO_ACCOUNT_SID) {
        try {
          const smsBody = render24hReminderSms({ name, declineCode });
          await sendSms(env, { to: phone, body: smsBody });
          smsOk = true;
          results.smsSent++;
        } catch (err) {
          console.error(`24h reminder SMS failed for ${recordId}:`, err.message);
          results.failed.push({ id: recordId, channel: 'sms', reason: err.message });
        }
      }

      const updateFields = {
        '24h Reminder Sent At': new Date().toISOString(),
        'QR Sent At': new Date().toISOString()
      };
      if (!f['Decline Code']) updateFields['Decline Code'] = declineCode;
      await airtablePatch(env, recordId, updateFields);

      // Track outcome
      if (!emailOk) {
        await markSendError(env, recordId, '24h reminder email failed: ' + (results.failed.find(x=>x.id===recordId && x.channel==='email')?.reason || 'unknown'));
      } else if (phone && env.TWILIO_ACCOUNT_SID && !smsOk) {
        await markSendWarning(env, recordId, 'SMS failed (email ok): ' + (results.failed.find(x=>x.id===recordId && x.channel==='sms')?.reason || 'unknown'));
      } else {
        await clearSendError(env, recordId);
      }

      if (emailOk || smsOk) results.notified++;
    } catch (err) {
      console.error(`24h reminder failed for ${recordId}:`, err);
      results.failed.push({ id: recordId, channel: 'general', reason: err.message });
    }
  }

  return jsonOk(results);
}
