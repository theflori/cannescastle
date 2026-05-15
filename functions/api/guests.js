// deploy-marker 1778506899
// GET /api/guests
// Returns all RSVP records from Airtable as JSON

export async function onRequestGet(context) {
  const { env } = context;

  const required = ['AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_NAME'];
  for (const k of required) {
    if (!env[k]) {
      return jsonError(`Missing env: ${k}`, 500);
    }
  }

  try {
    const records = await fetchAllRecords(env);
    // Build id -> name map for Plus One Of resolution
    const idToName = new Map();
    for (const r of records) {
      idToName.set(r.id, (r.fields && r.fields['Full Name']) || '');
    }
    const guests = records.map(r => formatRecord(r, idToName));
    return new Response(JSON.stringify({ guests, total: guests.length }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    return jsonError('Failed to fetch from Airtable: ' + err.message, 500);
  }
}

async function fetchAllRecords(env) {
  const records = [];
  let offset = null;
  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}`;

  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (offset) params.set('offset', offset);

    const res = await fetch(`${url}?${params}`, {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` }
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Airtable ${res.status}: ${text.substring(0, 200)}`);
    }

    const data = await res.json();
    records.push(...data.records);
    offset = data.offset || null;
  } while (offset);

  return records;
}

function formatRecord(record, idToName) {
  const f = record.fields || {};
  // Plus One Of: linked record field. Value is array of record IDs (or array of names if "use first field" option).
  const plusOneRaw = f['Plus One Of'];
  let plusOneOfId = '';
  let plusOneOfName = '';
  if (Array.isArray(plusOneRaw) && plusOneRaw.length > 0) {
    const first = plusOneRaw[0];
    if (typeof first === 'string' && first.startsWith('rec')) {
      plusOneOfId = first;
      plusOneOfName = idToName ? (idToName.get(first) || '') : '';
    } else {
      // Already a name string (Airtable returns string if linked-record uses display)
      plusOneOfName = String(first);
    }
  }
  // Normalize Instagram handle: strip @, strip URL prefix
  const igRaw = f['Instagram'] || '';
  const igHandle = String(igRaw)
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, '')
    .replace(/\/$/, '')
    .trim();

  return {
    id: record.id,
    name: f['Full Name'] || '',
    email: f['Email'] || '',
    phone: f['Phone'] || '',
    company: f['Company / Industry'] || '',
    instagram: igHandle,
    referredBy: f['Referred By'] || '',
    status: f['Status'] || '',
    messagingStatus: f['Messaging Status'] || '',
    source: f['Source'] || '',
    tags: Array.isArray(f['Tags']) ? f['Tags'] : [],
    notes: f['Internal Notes'] || '',
    igFollowers: typeof f['IG Followers'] === 'number' ? f['IG Followers'] : null,
    igAvatarUrl: f['IG Avatar URL'] || '',
    igLastRefresh: f['IG Last Refresh'] || '',
    igIsPrivate: typeof f['IG Private'] === 'boolean' ? f['IG Private'] : null,
    lastMessageSentAt: f['Last Message Sent At'] || '',
    lastEventUpdateSentAt: f['Last Event Update Sent At'] || '',
    reminder24hSentAt: f['24h Reminder Sent At'] || '',
    lastSendError: f['Last Send Error'] || '',
    lastSendErrorAt: f['Last Send Error At'] || '',
    lastSendErrorLevel: f['Last Send Error Level'] || '',  // 'error' | 'warning' | ''
    plusOneOfId,
    plusOneOfName,
    plusOneCode: f['Plus One Code'] || '',
    plusOneUsed: f['Plus One Used'] === true,
    plusOneAllowance: f['Plus One Allowance'] || '',
    hasPaid: f['Has Paid'] === true,
    paidAt: f['Paid At'] || '',
    stripeSessionId: f['Stripe Session ID'] || '',
    qrCode: f['QR Code'] || '',
    qrSentAt: f['QR Sent At'] || '',
    importance: f['Importance'] || '',
    checkedIn: f['Checked In'] === true,
    checkedInAt: f['Checked In At'] || '',
    checkInCount: typeof f['Check-in Count'] === 'number' ? f['Check-in Count'] : 0,
    createdTime: record.createdTime
  };
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
