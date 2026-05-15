// deploy-marker cron-list-closed-v1
// GET /api/cron/check-list-closed
//
// Run every 5–15 minutes by an external cron (cron-job.org, EasyCron, or a CF Worker).
// Steps:
//   1. Check LIST_CLOSED_AT env var. If unset or in the future → no-op (returns ok)
//   2. Find Airtable records that:
//      - have Created Time AFTER LIST_CLOSED_AT
//      - do NOT already have the tag "list-closed-sent"
//      - have an email
//      - are not Approved / Declined / Waitlist (don't double-up on people we've already handled)
//   3. For each, send the List-Closed mail with the per-guest premium checkout link.
//   4. Tag with "list-closed-sent" and set Status / Messaging Status to mark as handled.
//
// Auth: requires header  X-Cron-Secret: <SESSION_SECRET>  so randos can't trigger it.

import {
  airtablePatch, sendEmail, jsonError, jsonOk, markSendError, clearSendError
} from '../../_lib/messaging-utils.js';
import { renderListClosedEmail } from '../../_lib/templates.js';
import {
  isListClosed, getListClosingTime, buildPremiumCheckoutUrl
} from '../../_lib/event-config.js';

const TAG = 'list-closed-sent';
const MAX_PER_RUN = 25; // safety cap so a runaway list doesn't blast 500 mails in one tick

export async function onRequestGet(context) {
  return handle(context);
}
export async function onRequestPost(context) {
  return handle(context);
}

async function handle(context) {
  const { request, env } = context;

  // Auth — refuse if no secret is set OR mismatching
  const provided = request.headers.get('x-cron-secret') || new URL(request.url).searchParams.get('secret') || '';
  if (!env.SESSION_SECRET || provided !== env.SESSION_SECRET) {
    return jsonError('Unauthorized', 401);
  }

  // Required env
  for (const k of ['AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_NAME', 'RESEND_API_KEY']) {
    if (!env[k]) return jsonError('Missing env: ' + k, 500);
  }

  // Is the list actually closed?
  if (!isListClosed(env)) {
    const t = getListClosingTime(env);
    return jsonOk({
      action: 'noop',
      reason: t ? 'list closes at ' + t.toISOString() : 'LIST_CLOSED_AT not set'
    });
  }

  const closingTime = getListClosingTime(env);
  const closingTimeIso = closingTime.toISOString();

  // Fetch candidates from Airtable. Filter formula:
  //   - CREATED_TIME() > closingTime
  //   - {Status} != 'Approved' AND != 'Approved Ticket sent' AND != 'Rejected' AND != 'Waitlisted'
  //   - NOT(FIND('list-closed-sent', ARRAYJOIN(Tags)))
  // We can do most filtering server-side via Airtable's filterByFormula.
  const formula =
    `AND(` +
      `IS_AFTER(CREATED_TIME(), '${closingTimeIso}'),` +
      `{Email} != '',` +
      `OR({Status} = '', {Status} = 'Pending'),` +
      `NOT(FIND('${TAG}', ARRAYJOIN({Tags})))` +
    `)`;
  const url = new URL(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}`);
  url.searchParams.set('filterByFormula', formula);
  url.searchParams.set('pageSize', String(MAX_PER_RUN));

  const listRes = await fetch(url.toString(), {
    headers: { Authorization: 'Bearer ' + env.AIRTABLE_TOKEN }
  });
  if (!listRes.ok) {
    const t = await listRes.text();
    return jsonError('Airtable list failed: ' + listRes.status + ' ' + t.substring(0, 200), 500);
  }
  const data = await listRes.json();
  const records = Array.isArray(data.records) ? data.records : [];

  const results = { processed: 0, sent: 0, failed: [], skipped: [] };

  for (const rec of records) {
    const f = rec.fields || {};
    const recordId = rec.id;
    const email = (f['Email'] || '').trim();
    const name = f['Full Name'] || '';

    results.processed++;
    if (!email) { results.skipped.push({ id: recordId, reason: 'no-email' }); continue; }

    // Build per-guest premium checkout URL
    const payUrl = (env.STRIPE_SECRET_KEY) ? buildPremiumCheckoutUrl(env, recordId) : '';

    const mail = renderListClosedEmail({ name, payUrl });
    try {
      await sendEmail(env, { to: email, subject: mail.subject, html: mail.html, text: mail.text });
      results.sent++;

      // Tag + status update so we don't re-send + so the dashboard reflects state.
      const currentTags = Array.isArray(f['Tags']) ? f['Tags'] : [];
      const newTags = currentTags.includes(TAG) ? currentTags : [...currentTags, TAG];

      await airtablePatch(env, recordId, {
        'Tags': newTags,
        'Status': 'Rejected',
        'Messaging Status': 'Declined',
        'Last Message Sent At': new Date().toISOString()
      });
      await clearSendError(env, recordId);
    } catch (err) {
      console.error('[cron list-closed] failed for', recordId, err.message);
      results.failed.push({ id: recordId, reason: err.message });
      try { await markSendError(env, recordId, 'List-closed mail failed: ' + err.message); } catch {}
    }
  }

  return jsonOk(results);
}
