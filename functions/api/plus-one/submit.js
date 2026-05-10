// deploy-marker 1778434324
// POST /api/plus-one/submit
// Body: { id, firstName, lastName, email, phone }
//
// 1. Validate primary, ensure not already used
// 2. Create new record (Approved + Plus One Of = primary)
// 3. Generate decline code for new record
// 4. Mark primary as Plus One Used
// 5. Send welcome email + SMS to plus-one

import {
  airtableGet, airtablePatch, airtableCreate,
  sendEmail, sendSms, normalizePhone,
  generateUniqueCode,
  jsonError, jsonOk, escapeHtml
} from '../../_lib/messaging-utils.js';

const PUBLIC_BASE = 'https://chateau-cannes.fraimit.com';
const shortUrl = (code) => `${PUBLIC_BASE}/r/${code}`;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.AIRTABLE_TOKEN || !env.RESEND_API_KEY) {
    return jsonError('Server misconfigured', 500);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const { id, firstName, lastName, instagram, email, phone } = body;
  if (!id || !id.startsWith('rec')) return jsonError('Invalid id', 400);
  if (!firstName || !lastName) return jsonError('First and last name required', 400);
  if (!instagram || typeof instagram !== 'string' || instagram.trim().length === 0) {
    return jsonError('Instagram handle required', 400);
  }
  if (!email || !email.includes('@')) return jsonError('Valid email required', 400);

  // Clean Instagram handle defensively (frontend already strips, but double-check)
  const cleanInstagram = String(instagram).trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/\/$/, '');

  try {
    const primary = await airtableGet(env, id);
    const pf = primary.fields || {};

    if (pf['Plus One Used']) {
      return jsonError('Plus-one already added for this invitation', 409);
    }

    const primaryName = pf['Full Name'] || 'Your host';
    const fullName = `${firstName} ${lastName}`.trim();
    const normalizedPhone = normalizePhone(phone);

    // Create plus-one record (auto-approved)
    const newRecord = await airtableCreate(env, {
      'Full Name': fullName,
      'Email': email,
      'Phone': normalizedPhone,
      'Instagram': cleanInstagram,
      'Status': 'Approved',
      'Messaging Status': 'Approved',
      'Source': 'Plus-One',
      'Plus One Of': [id],
      'Last Message Sent At': new Date().toISOString()
    });
    const newId = newRecord.id;

    // Generate decline code for plus-one
    const declineCode = await generateUniqueCode(env, 'Decline Code');
    await airtablePatch(env, newId, { 'Decline Code': declineCode });

    // Mark primary as plus-one-used
    await airtablePatch(env, id, { 'Plus One Used': true });

    // Send welcome email
    let emailSent = false;
    try {
      const emailContent = renderPlusOneWelcomeEmail({ name: fullName, primaryName, declineCode });
      await sendEmail(env, {
        to: email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text
      });
      emailSent = true;
    } catch (err) {
      console.error('Plus-one email failed:', err.message);
    }

    // Send SMS
    let smsSent = false;
    if (normalizedPhone && env.TWILIO_ACCOUNT_SID) {
      try {
        const smsBody = renderPlusOneWelcomeSms({ name: fullName, primaryName, declineCode });
        await sendSms(env, { to: normalizedPhone, body: smsBody });
        smsSent = true;
      } catch (err) {
        console.error('Plus-one SMS failed:', err.message);
      }
    }

    return jsonOk({ created: newId, emailSent, smsSent });
  } catch (err) {
    return jsonError('Submission failed: ' + err.message, 500);
  }
}

// ============== EMAIL/SMS TEMPLATES (inline because cannescastle doesn't share templates.js) ==============

function renderPlusOneWelcomeEmail({ name, primaryName, declineCode }) {
  const firstName = (name || '').split(' ')[0] || 'there';
  const subject = "You are confirmed — Château Privé · 15 May 2026";
  const declineUrl = shortUrl(declineCode);

  const text = `Dear ${firstName},

${primaryName} added you as their guest at Château Privé.

Friday, 15 May 2026 · Cannes Californie
Doors at 17:00 — please be early.

The exact address will be shared 24 hours before the event by SMS.

Can't attend? ${declineUrl}

— Château Privé
`;

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=EB+Garamond:wght@400;500&display=swap" rel="stylesheet">
<style>
@media only screen and (max-width: 620px) {
  .container { width: 100% !important; }
  .px-40 { padding-left: 24px !important; padding-right: 24px !important; }
  .h1 { font-size: 30px !important; line-height: 1.15 !important; }
  .details td { font-size: 14px !important; }
  .details .lbl { width: 90px !important; padding-left: 20px !important; }
  .details .val { padding-right: 20px !important; }
  .py-top { padding-top: 36px !important; padding-bottom: 28px !important; }
}
body { margin: 0; padding: 0; }
</style>
</head>
<body style="margin:0;padding:0;background-color:#0F0C09;font-family:'EB Garamond',Georgia,serif;color:#F1ECDF">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#0F0C09" style="background-color:#0F0C09">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background-color:#1A1612">

<tr><td align="center" class="px-40" style="padding:20px 40px;border-bottom:1px solid rgba(241,236,223,0.12)">
<table role="presentation" width="100%"><tr>
<td align="left" style="font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:17px;color:#d4b884">Château Privé</td>
<td align="right" style="font-family:'EB Garamond',Georgia,serif;font-size:10px;color:rgba(241,236,223,0.55);letter-spacing:3px;text-transform:uppercase">15 May 2026</td>
</tr></table>
</td></tr>

<tr><td class="px-40 py-top" align="left" style="padding:40px 40px 28px">
<p style="margin:0 0 10px;font-family:'EB Garamond',Georgia,serif;font-size:10px;color:rgba(241,236,223,0.55);letter-spacing:3px;text-transform:uppercase">Cannes &middot; 15 May 2026</p>
<h1 class="h1" style="margin:0;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;font-size:36px;line-height:1.1;color:#d4b884;letter-spacing:-0.3px">You are confirmed.</h1>
</td></tr>

<tr><td class="px-40" align="left" style="padding:0 40px 28px">
<p style="margin:0 0 14px;font-family:'EB Garamond',Georgia,serif;font-size:16px;line-height:1.6;color:#F1ECDF">Dear ${escapeHtml(firstName)},</p>
<p style="margin:0;font-family:'EB Garamond',Georgia,serif;font-size:16px;line-height:1.6;color:rgba(241,236,223,0.85)">
<span style="color:#F1ECDF">${escapeHtml(primaryName)}</span> added you as their guest at <span style="color:#F1ECDF">Château Privé</span> &mdash; a private evening during the 79<sup style="font-size:10px">th</sup> Cannes Film Festival.
</p>
</td></tr>

<tr><td class="px-40" style="padding:0 40px">
<table role="presentation" class="details" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#231D17;border-top:1px solid rgba(241,236,223,0.12);border-bottom:1px solid rgba(241,236,223,0.12)">
<tr>
<td class="lbl" width="120" style="padding:16px 0 16px 24px;font-family:'EB Garamond',Georgia,serif;font-size:10px;color:rgba(241,236,223,0.55);letter-spacing:3px;text-transform:uppercase;vertical-align:top">Date</td>
<td class="val" style="padding:16px 24px 16px 0;font-family:'EB Garamond',Georgia,serif;font-size:15px;color:#F1ECDF;line-height:1.5">Friday, 15 May 2026</td>
</tr>
<tr><td colspan="2" style="border-top:1px solid rgba(241,236,223,0.08);line-height:0;font-size:0">&nbsp;</td></tr>
<tr>
<td class="lbl" style="padding:16px 0 16px 24px;font-family:'EB Garamond',Georgia,serif;font-size:10px;color:rgba(241,236,223,0.55);letter-spacing:3px;text-transform:uppercase;vertical-align:top">Place</td>
<td class="val" style="padding:16px 24px 16px 0;font-family:'EB Garamond',Georgia,serif;font-size:15px;color:#F1ECDF;line-height:1.5">Cannes Californie</td>
</tr>
<tr><td colspan="2" style="border-top:1px solid rgba(241,236,223,0.08);line-height:0;font-size:0">&nbsp;</td></tr>
<tr>
<td class="lbl" style="padding:16px 0 16px 24px;font-family:'EB Garamond',Georgia,serif;font-size:10px;color:rgba(241,236,223,0.55);letter-spacing:3px;text-transform:uppercase;vertical-align:top">Doors</td>
<td class="val" style="padding:16px 24px 16px 0;font-family:'EB Garamond',Georgia,serif;font-size:15px;color:#F1ECDF;line-height:1.5"><strong style="color:#d4b884">17:00</strong> &mdash; please be early</td>
</tr>
</table>
</td></tr>

<tr><td class="px-40" align="center" style="padding:18px 40px 0">
<p style="margin:0;font-family:'EB Garamond',Georgia,serif;font-size:12px;line-height:1.6;color:rgba(241,236,223,0.55);font-style:italic">The exact address will be shared 24 hours before the event by SMS.</p>
</td></tr>

<tr><td class="px-40" align="center" style="padding:24px 40px 36px">
<p style="margin:0;font-family:'EB Garamond',Georgia,serif;font-size:12px;color:rgba(241,236,223,0.55)">
Can't attend? <a href="${escapeHtml(declineUrl)}" style="color:#d4b884;text-decoration:underline">Let us know</a>
</p>
</td></tr>

<tr><td align="center" class="px-40" style="padding:24px 40px 32px;border-top:1px solid rgba(241,236,223,0.12);background-color:#0F0C09">
<p style="margin:0;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:16px;color:#d4b884">Château Privé</p>
</td></tr>

</table></td></tr></table></body></html>`;

  return { subject, text, html };
}

function renderPlusOneWelcomeSms({ name, primaryName, declineCode }) {
  const firstName = (name || '').split(' ')[0] || '';
  return `${firstName ? firstName + ', ' : ''}${primaryName} added you to Château Privé · 15 May · Cannes. Details in your email. Can't make it? ${shortUrl(declineCode)}`;
}
