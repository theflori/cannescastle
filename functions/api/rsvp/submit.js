// deploy-marker rsvp-submit-v1
// POST /api/rsvp/submit
//
// Public endpoint that the Frontend landing page calls when someone submits the
// "Request Access" form. Replaces the previous Formspree integration.
//
// Logic:
//   1. If list is CLOSED (env.LIST_CLOSED_AT is in the past):
//      - Creates Airtable record with tag 'list-closed-sent'
//      - Sets Status='Rejected', Messaging Status='Declined'
//      - Sends list-closed email with Stripe checkout link (€4000 Concierge)
//      - Returns { ok: true, closed: true }
//   2. If list is OPEN:
//      - Creates Airtable record (no tag, empty status)
//      - Sends a confirmation email ("RSVP received, under review")
//      - Returns { ok: true, closed: false }
//
// Body: { name, email, phone?, company?, instagram?, referredBy? }
//
// CORS: allowed from the Frontend domain.

import { airtableCreate, airtablePatch, sendEmail, jsonError, jsonOk } from '../../_lib/messaging-utils.js';
import { renderListClosedEmail } from '../../_lib/templates.js';
import { isListClosed, buildPremiumCheckoutUrl } from '../../_lib/event-config.js';
import { escapeHtml } from '../../_lib/messaging-utils.js';

const ALLOWED_ORIGINS = [
  'https://chateau-cannes.fraimit.com',
  'https://cannescastle.com',
  'https://cannes-dash.pages.dev'
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function withCors(response, origin) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || '').trim());
}

// Internal "we received your RSVP" template — used when list is open.
// Stays consistent with the rest of the system's voice.
function renderRsvpReceivedEmail({ name }) {
  const firstName = (name || '').split(' ')[0] || 'there';
  const subject = 'Your Cannes RSVP has been received';
  const text = `Dear ${firstName},

Thank you for your request to attend Château Privé on Friday, 15 May 2026.

Your details are now with us. Each application is reviewed personally — given the limited capacity, not all requests can be approved. If you are confirmed, you will receive a separate access confirmation with full event details.

We will be in touch.

With our regards,
Château Privé
`;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#F1ECDF;font-family:'EB Garamond',Georgia,serif;color:#1A1612">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F1ECDF"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#FBF7EC;border:1px solid rgba(26,22,18,0.12)">
<tr><td align="center" style="padding:28px 48px;border-bottom:1px solid rgba(26,22,18,0.12)">
<span style="font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:18px;color:#9a7d44">Château Privé</span>
<span style="float:right;font-size:11px;color:#8a8270;letter-spacing:3px;text-transform:uppercase">Cannes · MMXXVI</span>
</td></tr>
<tr><td align="center" style="padding:56px 48px 24px">
<p style="margin:0 0 18px;font-size:11px;color:#8a8270;letter-spacing:4px;text-transform:uppercase">Request Received</p>
<h1 style="margin:0 0 24px;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;font-size:48px;line-height:1.05;color:#B8965A;letter-spacing:-0.5px">Thank you.</h1>
<table align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 28px"><tr><td width="60" height="1" bgcolor="#B8965A">&nbsp;</td></tr></table>
<p style="margin:0 0 18px;font-size:17px;line-height:1.7;color:#1A1612;text-align:left">Dear ${escapeHtml(firstName)},</p>
<p style="margin:0 0 18px;font-size:17px;line-height:1.7;color:#4a4337;text-align:left">Thank you for your request to attend <span style="color:#1A1612">Château Privé</span> on Friday, 15 May 2026.</p>
<p style="margin:0 0 18px;font-size:17px;line-height:1.7;color:#4a4337;text-align:left">Your details are now with us. Each application is reviewed personally — given the limited capacity, not all requests can be approved. If you are confirmed, you will receive a separate access confirmation with full event details.</p>
<p style="margin:0 0 24px;font-size:17px;line-height:1.7;color:#4a4337;text-align:left">We will be in touch.</p>
</td></tr>
<tr><td align="center" style="padding:24px 48px 40px;border-top:1px solid rgba(26,22,18,0.08)">
<p style="margin:0;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:15px;color:#8a8270">With our regards,<br><span style="color:#9a7d44">Château Privé</span></p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { subject, text, html };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  for (const k of ['AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_NAME', 'RESEND_API_KEY']) {
    if (!env[k]) return withCors(jsonError('Server misconfigured: ' + k, 500), origin);
  }

  let body;
  try { body = await request.json(); }
  catch { return withCors(jsonError('Invalid JSON', 400), origin); }

  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const phone = (body.phone || '').trim();
  const company = (body.company || '').trim();
  const instagram = (body.instagram || '').trim().replace(/^@/, '');
  const referredBy = (body.referredBy || '').trim();

  if (!name || name.length < 2) return withCors(jsonError('Please enter your full name', 400), origin);
  if (!isValidEmail(email)) return withCors(jsonError('Please enter a valid email', 400), origin);

  // Build Airtable fields
  const fields = {
    'Full Name': name,
    'Email': email
  };
  if (phone)      fields['Phone'] = phone;
  if (company)    fields['Company'] = company;
  if (instagram)  fields['Instagram'] = instagram;
  if (referredBy) fields['Referred By'] = referredBy;

  const listClosed = isListClosed(env);

  // If list is closed, pre-fill rejection state + tag
  if (listClosed) {
    fields['Tags'] = ['list-closed-sent'];
    fields['Status'] = 'Rejected';
    fields['Messaging Status'] = 'Declined';
    fields['Last Message Sent At'] = new Date().toISOString();
  }

  // 1. Create Airtable record
  let createdRecord;
  try {
    createdRecord = await airtableCreate(env, fields);
  } catch (err) {
    return withCors(jsonError('Could not save your details: ' + err.message, 500), origin);
  }
  const recordId = createdRecord.id;
  if (!recordId) return withCors(jsonError('Airtable did not return a record id', 500), origin);

  // 2. Send appropriate email
  try {
    if (listClosed) {
      const payUrl = env.STRIPE_SECRET_KEY ? buildPremiumCheckoutUrl(env, recordId) : '';
      const mail = renderListClosedEmail({ name, payUrl });
      await sendEmail(env, { to: email, subject: mail.subject, html: mail.html, text: mail.text });
    } else {
      const mail = renderRsvpReceivedEmail({ name });
      await sendEmail(env, { to: email, subject: mail.subject, html: mail.html, text: mail.text });
    }
  } catch (err) {
    console.error('[rsvp-submit] email send failed for', recordId, err.message);
    // Non-fatal — record is in Airtable, you can manually re-send from the dashboard
  }

  return withCors(jsonOk({ ok: true, closed: listClosed, recordId }), origin);
}
