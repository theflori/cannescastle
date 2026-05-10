// deploy-marker 1778406072
// Shared utility for decline / plus-one flows.
// Airtable lookups by code (no HMAC tokens — code itself is the credential).

// ============== AIRTABLE ==============

export async function airtableGet(env, recordId) {
  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}/${recordId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable GET ${res.status}: ${text.substring(0, 200)}`);
  }
  return await res.json();
}

// Look up a record by a 6-char code in either Decline Code or Plus One Code field.
// Returns { record, codeType } or null if not found.
export async function airtableGetByCode(env, code) {
  if (!code || typeof code !== 'string') return null;

  // Try Decline Code first
  const declineFormula = encodeURIComponent(`{Decline Code}="${code}"`);
  let url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}?filterByFormula=${declineFormula}&maxRecords=1`;
  let res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` }
  });
  if (res.ok) {
    const data = await res.json();
    if (data.records && data.records.length > 0) {
      return { record: data.records[0], codeType: 'decline' };
    }
  }

  // Try Plus One Code
  const plusOneFormula = encodeURIComponent(`{Plus One Code}="${code}"`);
  url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}?filterByFormula=${plusOneFormula}&maxRecords=1`;
  res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` }
  });
  if (res.ok) {
    const data = await res.json();
    if (data.records && data.records.length > 0) {
      return { record: data.records[0], codeType: 'plus-one' };
    }
  }

  return null;
}

export async function airtablePatch(env, recordId, fields) {
  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}/${recordId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields, typecast: true })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable PATCH ${res.status}: ${text.substring(0, 200)}`);
  }
  return await res.json();
}

export async function airtableCreate(env, fields) {
  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields, typecast: true })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable CREATE ${res.status}: ${text.substring(0, 200)}`);
  }
  return await res.json();
}

// ============== CODE GENERATION ==============

export function generateCode() {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let code = '';
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 6; i++) {
    code += chars[buf[i] % 36];
  }
  return code;
}

export async function generateUniqueCode(env, fieldName) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const formula = encodeURIComponent(`{${fieldName}}="${code}"`);
    const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}?filterByFormula=${formula}&maxRecords=1`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` }
    });
    if (!res.ok) return code; // fallback if lookup fails
    const data = await res.json();
    if (!data.records || data.records.length === 0) return code;
  }
  throw new Error(`Could not generate unique ${fieldName}`);
}

// ============== RESEND (Email) ==============

export async function sendEmail(env, { to, subject, html, text }) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');

  const from = env.FROM_EMAIL || env.RESEND_FROM || 'Château Privé <rsvp@fraimit.com>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from, to, subject, html, text,
      reply_to: env.REPLY_TO_EMAIL || 'rsvp@fraimit.com'
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend ${res.status}: ${errText.substring(0, 200)}`);
  }
  return await res.json();
}

// ============== TWILIO (SMS) ==============

export async function sendSms(env, { to, body }) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) {
    throw new Error('Twilio credentials not configured');
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);

  const params = new URLSearchParams();
  params.append('To', to);
  params.append('From', env.TWILIO_PHONE_NUMBER);
  params.append('Body', body);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Twilio ${res.status}: ${errText.substring(0, 300)}`);
  }
  return await res.json();
}

// ============== HELPERS ==============

export function normalizePhone(raw) {
  if (!raw) return '';
  let p = String(raw).trim().replace(/[^\d+]/g, '');
  if (p.startsWith('00')) p = '+' + p.substring(2);
  if (!p.startsWith('+') && p.startsWith('0')) {
    p = '+49' + p.substring(1);
  } else if (!p.startsWith('+')) {
    p = '+' + p;
  }
  return p;
}

export function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function jsonOk(payload) {
  return new Response(JSON.stringify({ ok: true, ...payload }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
