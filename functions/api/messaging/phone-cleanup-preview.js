// deploy-marker 1778513130
// POST /api/messaging/phone-cleanup-preview
// Body: { recordIds?: string[] }  - if missing, scans ALL messaging guests
//
// Returns dry-run preview - what each phone would become after cleanup.
// Does NOT modify Airtable.

import { jsonError, jsonOk } from '../../_lib/messaging-utils.js';
import { cleanupPhone, validateCleaned } from '../../_lib/phone-cleanup.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.AIRTABLE_TOKEN) return jsonError('Missing AIRTABLE_TOKEN', 500);

  let body = {};
  try { body = await request.json(); } catch {}

  // Pull all records (paginated)
  const records = await fetchAllRecords(env);

  const previews = [];
  for (const r of records) {
    const f = r.fields || {};
    const phone = f['Phone'] || '';
    const email = f['Email'] || '';
    const status = f['Messaging Status'] || '';

    // Skip if no phone at all
    if (!phone) continue;

    const result = cleanupPhone(phone, email);
    const validation = validateCleaned(result.cleaned);

    // Skip if already clean and unchanged
    if (result.status === 'unchanged') continue;

    previews.push({
      id: r.id,
      name: f['Full Name'] || '',
      email,
      messagingStatus: status,
      original: result.original,
      cleaned: result.cleaned,
      status: result.status,
      action: result.action,
      country: result.country || null,
      valid: validation.valid,
      validationReason: validation.reason
    });
  }

  // Group by status for the UI
  const summary = {
    total: previews.length,
    ok: previews.filter(p => p.status === 'ok' || p.status === 'unchanged').length,
    guessed: previews.filter(p => p.status === 'guessed').length,
    likely: previews.filter(p => p.status === 'likely').length,
    needsReview: previews.filter(p => p.status === 'needs_review' || p.status === 'invalid').length
  };

  return jsonOk({ previews, summary });
}

async function fetchAllRecords(env) {
  const records = [];
  let offset = '';
  for (let i = 0; i < 10; i++) {  // safety: max 10 pages
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
