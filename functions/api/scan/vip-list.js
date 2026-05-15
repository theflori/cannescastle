// deploy-marker scan-vip-list-v1
// GET /api/scan/vip-list
//
// Returns guests with Importance = 'VIP/Car' for the scanner staff.
// Lightweight payload — only the fields needed at the door:
//   name, instagram, igAvatarUrl, igFollowers, checkedIn, company, importance
//
// Accessible by staff role (allowed via middleware on /api/scan/*).

import { jsonError, jsonOk } from '../../_lib/messaging-utils.js';

export async function onRequestGet(context) {
  const { env } = context;

  for (const k of ['AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_NAME']) {
    if (!env[k]) return jsonError('Missing env: ' + k, 500);
  }

  // Pull all VIP/Car records. Single Airtable page can carry up to 100;
  // for safety we paginate up to 5 pages (500 records) — way above any sane
  // VIP allocation for one evening.
  const baseUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}`;
  const formula = "{Importance} = 'VIP/Car'";
  const all = [];
  let offset = '';
  for (let i = 0; i < 5; i++) {
    const url = new URL(baseUrl);
    url.searchParams.set('filterByFormula', formula);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetch(url.toString(), {
      headers: { Authorization: 'Bearer ' + env.AIRTABLE_TOKEN }
    });
    if (!res.ok) {
      const t = await res.text();
      return jsonError('Airtable error ' + res.status + ': ' + t.substring(0, 200), 500);
    }
    const data = await res.json();
    if (Array.isArray(data.records)) all.push(...data.records);
    offset = data.offset || '';
    if (!offset) break;
  }

  const guests = all.map(rec => {
    const f = rec.fields || {};
    const igRaw = f['Instagram'] || '';
    const igHandle = igRaw.toString().trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '');
    return {
      id: rec.id,
      name: f['Full Name'] || '',
      instagram: igHandle,
      igAvatarUrl: f['IG Avatar URL'] || '',
      igFollowers: typeof f['IG Followers'] === 'number' ? f['IG Followers'] : null,
      company: f['Company / Industry'] || '',
      checkedIn: f['Checked In'] === true,
      checkedInAt: f['Checked In At'] || '',
      hasPaid: f['Has Paid'] === true,
      status: f['Status'] || '',
      importance: f['Importance'] || ''
    };
  });

  // Sort: not-checked-in first, then alphabetically by name
  guests.sort((a, b) => {
    if (a.checkedIn !== b.checkedIn) return a.checkedIn ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  return jsonOk({ guests, count: guests.length });
}
