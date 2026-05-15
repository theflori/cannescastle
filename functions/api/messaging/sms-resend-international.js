// deploy-marker 1778520624
// POST /api/messaging/sms-resend-international
//
// Two modes:
//   - { preview: true } → returns list of candidates (no sends)
//   - { send: true, ids: [...] } → sends SMS to selected records
//
// Candidates: Messaging Status = Approved AND Phone starts with "+" AND Phone NOT starts with "+49"

import {
  airtableGet, airtablePatch, sendSms, jsonError, jsonOk,
  markSendError, markSendWarning, clearSendError
} from '../../_lib/messaging-utils.js';
import { renderConfirmationSms } from '../../_lib/templates.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.AIRTABLE_TOKEN) return jsonError('Missing AIRTABLE_TOKEN', 500);

  let body = {};
  try { body = await request.json(); } catch {}

  // ============== PREVIEW MODE ==============
  if (body.preview) {
    const records = await fetchAllRecords(env);
    const candidates = [];
    for (const r of records) {
      const f = r.fields || {};
      const status = f['Messaging Status'] || '';
      const phone = f['Phone'] || '';
      if (status !== 'Approved') continue;
      if (!phone.startsWith('+')) continue;
      if (phone.startsWith('+49')) continue;
      candidates.push({
        id: r.id,
        name: f['Full Name'] || '',
        email: f['Email'] || '',
        phone,
        countryCode: phone.match(/^\+(\d{1,4})/)?.[1] || ''
      });
    }
    return jsonOk({ candidates, count: candidates.length });
  }

  // ============== SEND MODE ==============
  if (body.send && Array.isArray(body.ids) && body.ids.length > 0) {
    if (body.ids.length > 200) return jsonError('Too many recipients (max 200)', 400);

    const sent = [];
    const failed = [];

    for (const id of body.ids) {
      try {
        const record = await airtableGet(env, id);
        const f = record.fields || {};
        const phone = f['Phone'] || '';
        const name = f['Full Name'] || '';
        const declineCode = f['Decline Code'] || '';

        if (!phone.startsWith('+') || phone.startsWith('+49')) {
          failed.push({ id, reason: 'Not eligible (DE or no +)' });
          continue;
        }

        const smsText = renderConfirmationSms({ name, declineCode });
        try {
          await sendSms({ ...env, INTL_SMS_BYPASS: 'true' }, { to: phone, body: smsText });
          await airtablePatch(env, id, { 'Last Message Sent At': new Date().toISOString() });
          await clearSendError(env, id);
          sent.push({ id, name, phone });
        } catch (smsErr) {
          await markSendWarning(env, id, 'Int. SMS resend failed: ' + smsErr.message);
          failed.push({ id, reason: smsErr.message });
        }
      } catch (recErr) {
        failed.push({ id, reason: 'Record fetch failed: ' + recErr.message });
      }
    }

    return jsonOk({ sent: sent.length, failed: failed.length, failedDetails: failed });
  }

  return jsonError('Must specify { preview: true } or { send: true, ids: [...] }', 400);
}

async function fetchAllRecords(env) {
  const records = [];
  let offset = '';
  for (let i = 0; i < 10; i++) {
    const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}?pageSize=100${offset ? '&offset=' + offset : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` } });
    if (!res.ok) throw new Error(`Airtable ${res.status}`);
    const data = await res.json();
    records.push(...(data.records || []));
    if (!data.offset) break;
    offset = data.offset;
  }
  return records;
}
