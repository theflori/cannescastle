// deploy-marker 1778506899
// Shared utilities for messaging — HMAC tokens, email & SMS senders

// ============== TOKENS ==============

// Generate a signed token: base64(payload).base64(hmac)
// payload = { recordId, purpose, exp }
export async function signToken(payload, secret) {
  const data = btoa(JSON.stringify(payload));
  const sig = await hmac(data, secret);
  return `${data}.${sig}`;
}

export async function verifyToken(token, secret, expectedPurpose) {
  try {
    if (!token || typeof token !== 'string') return null;
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;
    const expectedSig = await hmac(data, secret);
    if (sig !== expectedSig) return null;

    const payload = JSON.parse(atob(data));
    if (payload.exp && payload.exp < Date.now()) return null;
    if (expectedPurpose && payload.purpose !== expectedPurpose) return null;

    return payload;
  } catch {
    return null;
  }
}

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// ============== AIRTABLE HELPERS ==============

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

// Generate a 6-character random code (lowercase + digits, ~2 billion combinations)
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

// Generate a unique code that doesn't already exist in Airtable for the given field
// Tries up to 5 times, then throws
export async function generateUniqueCode(env, fieldName) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const formula = encodeURIComponent(`{${fieldName}}="${code}"`);
    const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}?filterByFormula=${formula}&maxRecords=1`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` }
    });
    if (!res.ok) {
      // If lookup fails, return the code anyway (collision risk is tiny)
      return code;
    }
    const data = await res.json();
    if (!data.records || data.records.length === 0) return code;
  }
  throw new Error(`Could not generate unique ${fieldName}`);
}

// ============== RESEND ==============

export async function sendEmail(env, { to, subject, html, text }) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');

  const from = env.RESEND_FROM || 'Château Privé <rsvp@fraimit.com>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from, to, subject, html, text })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend ${res.status}: ${errText.substring(0, 200)}`);
  }

  return await res.json();
}

// ============== TWILIO ==============

// Marker error thrown when we intentionally skip an SMS due to Twilio account
// restrictions (e.g. international destinations blocked while Geo-Permissions
// issue is being resolved with Twilio Support). Callers detect this and treat
// as "skipped", not "failed".
export class SmsSkippedError extends Error {
  constructor(reason, destination) {
    super(`SMS skipped: ${reason} (to=${destination})`);
    this.name = 'SmsSkippedError';
    this.skipped = true;
    this.destination = destination;
  }
}

// Set TWILIO_INTL_BLOCKED=true in Cloudflare env to skip non-DE sends without
// hitting Twilio (avoids cluttering Issues tab with 21408 errors during the
// Twilio account fix process).
function isInternationalBlocked(env) {
  return env.TWILIO_INTL_BLOCKED === 'true' || env.TWILIO_INTL_BLOCKED === '1';
}

export async function sendSms(env, { to, body }) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) {
    throw new Error('Twilio credentials not configured');
  }

  // Hard-sanitize the destination number to E.164 (no spaces, dashes, parens).
  const sanitizedTo = sanitizeE164(to);
  if (!sanitizedTo) {
    throw new Error(`Invalid phone number for SMS: "${to}"`);
  }

  // Auto-send only fires for +49 (DE). Non-DE numbers are silently skipped here so the
  // bulk send endpoints (confirm/waitlist/etc) don't trigger Twilio 21408 errors at scale.
  // International sends are done manually via the "Send international SMS" UI which sets
  // env.INTL_SMS_BYPASS at request time to bypass this check.
  if (!sanitizedTo.startsWith('+49') && env.INTL_SMS_BYPASS !== 'true') {
    return { sid: 'SKIPPED_NON_DE', status: 'skipped', skipped: true, reason: 'auto_send_de_only' };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);

  const params = new URLSearchParams();
  params.append('To', sanitizedTo);
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

// ============== PHONE NORMALIZATION ==============

// Strict E.164 sanitization for outbound SMS. Removes spaces, dashes, parens,
// dots, and any other non-digit characters except the leading +.
// Returns "" if the result is not a valid E.164 number.
export function sanitizeE164(input) {
  if (!input) return '';
  let s = String(input).trim();
  // Convert "00..." prefix to "+..."
  if (s.startsWith('00')) s = '+' + s.slice(2);
  // Strip everything that isn't digit or leading +
  const hasPlus = s.startsWith('+');
  const digits = s.replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.length < 8 || digits.length > 15) return '';
  return (hasPlus ? '+' : '+') + digits;
}

export function normalizePhone(raw) {
  if (!raw) return '';
  let p = String(raw).trim().replace(/[^\d+]/g, '');
  // If starts with 00, replace with +
  if (p.startsWith('00')) p = '+' + p.substring(2);
  // If no +, assume DE (most likely user base)
  if (!p.startsWith('+') && p.startsWith('0')) {
    p = '+49' + p.substring(1);
  } else if (!p.startsWith('+')) {
    p = '+' + p;
  }
  return p;
}

// ============== HELPERS ==============

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

export function getBaseUrl(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ============== ERROR TRACKING ==============
// Helpers to mark send success / failure on a guest record.
// Used by all send endpoints to populate Last Send Error fields.

// Call when email FAILS (most critical - email is the primary channel)
export async function markSendError(env, recordId, message) {
  try {
    await airtablePatch(env, recordId, {
      'Last Send Error': String(message || 'Unknown error').slice(0, 500),
      'Last Send Error At': new Date().toISOString(),
      'Last Send Error Level': 'error'
    });
  } catch (err) {
    // If this fails, the 3 Airtable error tracking fields likely don't exist.
    // Log to console so the operator can diagnose why Issues tab shows 0.
    console.error('[markSendError] Airtable patch failed for', recordId, '-', err.message,
      '\nThis usually means the 3 error tracking fields (Last Send Error, Last Send Error At, Last Send Error Level) are missing from your Airtable schema. Add them as: Long Text, DateTime, Single Line Text.');
  }
}

// Call when ONLY SMS fails (email worked - less critical)
export async function markSendWarning(env, recordId, message) {
  try {
    await airtablePatch(env, recordId, {
      'Last Send Error': String(message || 'SMS warning').slice(0, 500),
      'Last Send Error At': new Date().toISOString(),
      'Last Send Error Level': 'warning'
    });
  } catch (err) {
    console.error('[markSendWarning] Airtable patch failed for', recordId, '-', err.message,
      '\nAdd Last Send Error (Long Text), Last Send Error At (DateTime), Last Send Error Level (Single Line Text) fields to your Airtable.');
  }
}

// Call on full success - clears the error fields
export async function clearSendError(env, recordId) {
  try {
    await airtablePatch(env, recordId, {
      'Last Send Error': '',
      'Last Send Error At': null,
      'Last Send Error Level': ''
    });
  } catch (err) {
    // Don't log this one — it's expected if fields don't exist yet
  }
}
