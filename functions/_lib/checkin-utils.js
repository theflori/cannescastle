// deploy-marker checkin-utils-v1
// Helpers for the QR / check-in flow.

import { airtableGet, airtablePatch, jsonError, jsonOk } from './messaging-utils.js';

/**
 * Generate a random UUID-style token for the QR code.
 * Worker runtime has crypto.randomUUID() available.
 */
export function generateQrCode() {
  return crypto.randomUUID();
}

/**
 * Find a guest record by their QR Code value.
 * Returns the record or null.
 *
 * Uses Airtable's filterByFormula to look up by the QR Code field.
 * In a 200-guest event this is fast enough; for larger we'd cache.
 */
export async function findGuestByQr(env, qrCode) {
  if (!qrCode || typeof qrCode !== 'string' || qrCode.length < 8) return null;

  // Sanitize for Airtable formula — only allow UUID-safe chars
  const safe = qrCode.replace(/[^a-zA-Z0-9-]/g, '');
  if (safe !== qrCode) return null;

  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}` +
    `?filterByFormula=${encodeURIComponent(`{QR Code}='${safe}'`)}` +
    `&maxRecords=1`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable lookup failed: ${res.status} ${text.substring(0, 200)}`);
  }
  const data = await res.json();
  return data.records && data.records.length > 0 ? data.records[0] : null;
}

/**
 * Ensure a guest has a QR Code assigned. If one already exists, return it.
 * Otherwise generate, save, return.
 */
export async function ensureQrCode(env, recordId) {
  const record = await airtableGet(env, recordId);
  const existing = record.fields && record.fields['QR Code'];
  if (existing && typeof existing === 'string' && existing.length >= 8) {
    return existing;
  }
  const fresh = generateQrCode();
  await airtablePatch(env, recordId, { 'QR Code': fresh });
  return fresh;
}

/**
 * Mark a guest as checked in. Increments the check-in count.
 * Returns the updated record state for the scanner UI.
 */
export async function checkInGuest(env, record) {
  const f = record.fields || {};
  const currentCount = typeof f['Check-in Count'] === 'number' ? f['Check-in Count'] : 0;
  const wasAlreadyCheckedIn = f['Checked In'] === true;

  const patch = {
    'Checked In': true,
    'Check-in Count': currentCount + 1
  };
  // Only set the timestamp on the FIRST check-in
  if (!wasAlreadyCheckedIn) {
    patch['Checked In At'] = new Date().toISOString();
  }

  await airtablePatch(env, record.id, patch);

  // Look up plus-one companion: someone with their Plus One Of -> this guest's record id
  let plusOneCompanionName = '';
  let plusOneCompanionStatus = '';
  try {
    const companion = await findPlusOneCompanion(env, record.id);
    if (companion) {
      plusOneCompanionName = companion.name;
      plusOneCompanionStatus = companion.status;
    }
  } catch (err) {
    console.error('plus-one lookup failed:', err.message);
    // Non-fatal — scanner still works without it
  }

  return {
    recordId: record.id,
    name: f['Full Name'] || '',
    instagram: f['Instagram'] || '',
    igAvatarUrl: f['IG Avatar URL'] || '',
    messagingStatus: f['Messaging Status'] || '',
    hasPaid: f['Has Paid'] === true,
    tags: Array.isArray(f['Tags']) ? f['Tags'] : [],
    notes: f['Internal Notes'] || '',
    importance: f['Importance'] || '',
    plusOneOfName: extractPlusOneName(f),
    plusOneAllowance: f['Plus One Allowance'] || '',
    plusOneUsed: f['Plus One Used'] === true,
    plusOneCode: f['Plus One Code'] || '',
    plusOneCompanionName,         // if THIS guest brought a +1, who is it
    plusOneCompanionStatus,       // and what's that companion's messaging status
    previousCheckInCount: currentCount,
    newCheckInCount: currentCount + 1,
    wasAlreadyCheckedIn,
    firstCheckedInAt: f['Checked In At'] || new Date().toISOString()
  };
}

/**
 * Find a guest whose "Plus One Of" field links to the given record id.
 * Returns { name, status } if found, otherwise null.
 */
async function findPlusOneCompanion(env, recordId) {
  // Plus One Of is a linked-record field. We use FIND() against the array of linked names —
  // Airtable's formula syntax for linked fields treats them as comma-joined strings.
  // Easier: just paginate up to 100 records with non-empty Plus One Of and match in JS.
  // For a 200-guest event this is fine.
  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}` +
    `?filterByFormula=${encodeURIComponent(`NOT({Plus One Of}="")`)}` +
    `&pageSize=100`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` }
  });
  if (!res.ok) return null;
  const data = await res.json();

  for (const r of (data.records || [])) {
    const raw = r.fields && r.fields['Plus One Of'];
    if (!Array.isArray(raw)) continue;
    // Could be either record IDs or names depending on field config
    if (raw.includes(recordId)) {
      return {
        name: r.fields['Full Name'] || '',
        status: r.fields['Messaging Status'] || ''
      };
    }
  }
  return null;
}

function extractPlusOneName(fields) {
  const raw = fields['Plus One Of'];
  if (!Array.isArray(raw) || raw.length === 0) return '';
  const first = raw[0];
  return typeof first === 'string' && !first.startsWith('rec') ? first : '';
}

export { jsonError, jsonOk };
