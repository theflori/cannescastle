// deploy-marker 1778406072
// POST /api/send-sms
// Body: { recordId, message?, template? }
//
// For now this is a STUB — it does not actually send SMS via Twilio.
// It logs what would be sent and returns success, so the UI flow can be tested.
//
// To enable real Twilio sending later:
//   1. Set env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
//   2. Replace the STUB section below with the actual fetch to Twilio's API
//
// The architecture is status-trigger ready: you can call this from anywhere
// that knows a recordId, and templates can be expanded later.

const TEMPLATES = {
  acceptance: (g) => `Hi ${g.firstName}, your access to Château Privé on May 15 is confirmed. Address & details follow shortly.`,
  vip: (g) => `Hi ${g.firstName}, you've been confirmed as a VIP guest at Château Privé. We look forward to hosting you on May 15.`,
  waitlist: (g) => `Hi ${g.firstName}, you're on the waitlist for Château Privé on May 15. We'll let you know as soon as a spot opens.`,
  decline: (g) => `Hi ${g.firstName}, unfortunately we cannot accommodate your request for Château Privé on May 15. Thank you for your interest.`,
  reminder: (g) => `Reminder: Château Privé tonight, ${g.firstName}. Doors 16:00. Address & dress code on the website.`
};

export async function onRequestPost(context) {
  const { request, env } = context;

  for (const k of ['AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_NAME']) {
    if (!env[k]) return jsonError(`Missing env: ${k}`, 500);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const { recordId, template, message: customMessage } = body;
  if (!recordId) return jsonError('Missing recordId', 400);

  // Fetch the record to get phone + name
  const recordUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_NAME}/${recordId}`;
  let record;
  try {
    const res = await fetch(recordUrl, {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` }
    });
    if (!res.ok) return jsonError(`Airtable ${res.status}`, res.status);
    record = await res.json();
  } catch (err) {
    return jsonError('Record fetch failed: ' + err.message, 500);
  }

  const f = record.fields || {};
  const phone = f['Phone'];
  const fullName = f['Full Name'] || '';
  const firstName = fullName.split(' ')[0] || 'there';

  if (!phone) return jsonError('No phone number on record', 400);

  // Resolve message
  let message = customMessage;
  if (!message && template && TEMPLATES[template]) {
    message = TEMPLATES[template]({ firstName, fullName });
  }
  if (!message) return jsonError('No message or valid template provided', 400);

  // ============== STUB START ==============
  // For now, log what would be sent. Real Twilio integration goes here later.
  console.log('[SMS-STUB] Would send to', phone, ':', message);

  const isLive = !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER);

  if (!isLive) {
    return new Response(JSON.stringify({
      ok: true,
      mode: 'stub',
      to: phone,
      message,
      note: 'No Twilio credentials configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER env vars to enable live sending.'
    }), { headers: { 'Content-Type': 'application/json' } });
  }
  // ============== STUB END ==============

  // ============== LIVE TWILIO ==============
  // Will be activated once env vars are present.
  try {
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
    const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
    const params = new URLSearchParams({
      From: env.TWILIO_FROM_NUMBER,
      To: phone,
      Body: message
    });
    const res = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });
    const data = await res.json();
    if (!res.ok) return jsonError(`Twilio ${res.status}: ${data.message || 'unknown'}`, 500);
    return new Response(JSON.stringify({ ok: true, mode: 'live', sid: data.sid, to: phone }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return jsonError('Twilio call failed: ' + err.message, 500);
  }
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
