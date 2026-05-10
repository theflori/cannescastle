// deploy-marker 1778410127
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

${primaryName} added you as their guest for Château Privé.

Date: Friday, 15 May 2026
Place: A private château · Cannes Californie
Doors: 16:00 (Setters) · 17:00 (Main) · 18:00 hard close

The exact address will be sent 48 hours before the event by SMS.

Can't attend?
${declineUrl}

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
  .px-48 { padding-left: 28px !important; padding-right: 28px !important; }
  .h1 { font-size: 56px !important; }
}
body { margin: 0; padding: 0; }
</style>
</head>
<body style="margin:0;padding:0;background-color:#0F0C09;font-family:'EB Garamond',Georgia,serif;color:#F1ECDF">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#0F0C09" style="background-color:#0F0C09">
<tr><td align="center" style="padding:40px 16px">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background-color:#1A1612">

<tr><td align="center" class="px-48" style="padding:24px 48px;border-bottom:1px solid rgba(241,236,223,0.12)">
<table role="presentation" width="100%"><tr>
<td align="left" style="font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:18px;color:#d4b884">Château Privé</td>
<td align="right" style="font-family:'EB Garamond',Georgia,serif;font-size:11px;color:rgba(241,236,223,0.55);letter-spacing:3px;text-transform:uppercase">Cannes &middot; MMXXVI</td>
</tr></table>
</td></tr>

<tr><td class="px-48" align="center" style="padding:64px 48px 32px">
<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 28px">
<tr><td width="72" height="72" align="center" valign="middle" style="border:1px solid #B8965A;border-radius:36px;font-family:Georgia,serif;font-size:28px;color:#d4b884;line-height:72px">&#10003;</td></tr>
</table>
<p style="margin:0 0 22px;font-family:'EB Garamond',Georgia,serif;font-size:11px;color:rgba(241,236,223,0.65);letter-spacing:4px;text-transform:uppercase">You are confirmed</p>
<h1 class="h1" style="margin:0 0 24px;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;font-size:64px;line-height:1;color:#d4b884">Welcome.</h1>
<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 32px">
<tr><td width="60" height="1" bgcolor="#B8965A" style="background-color:#B8965A;line-height:1px;font-size:0">&nbsp;</td></tr>
</table>
<p style="margin:0 0 20px;font-family:'EB Garamond',Georgia,serif;font-size:17px;line-height:1.65;color:#F1ECDF;text-align:left">Dear ${escapeHtml(firstName)},</p>
<p style="margin:0;font-family:'EB Garamond',Georgia,serif;font-size:17px;line-height:1.65;color:rgba(241,236,223,0.78);text-align:left">
<span style="color:#F1ECDF">${escapeHtml(primaryName)}</span> has added you as their guest for <span style="color:#F1ECDF">Château Privé</span>, a private evening during the 79<sup style="font-size:11px">th</sup> Cannes Film Festival.
</p>
</td></tr>

<tr><td class="px-48" style="padding:0 48px 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#231D17;border-top:1px solid rgba(241,236,223,0.12);border-bottom:1px solid rgba(241,236,223,0.12)">
<tr>
<td width="140" style="padding:18px 0 18px 28px;font-family:'EB Garamond',Georgia,serif;font-size:11px;color:rgba(241,236,223,0.55);letter-spacing:3px;text-transform:uppercase;vertical-align:top">Date</td>
<td style="padding:18px 28px 18px 0;font-family:'EB Garamond',Georgia,serif;font-size:16px;color:#F1ECDF;line-height:1.5">Friday, 15 May 2026</td>
</tr>
<tr><td colspan="2" style="border-top:1px solid rgba(241,236,223,0.08);line-height:0;font-size:0">&nbsp;</td></tr>
<tr>
<td style="padding:18px 0 18px 28px;font-family:'EB Garamond',Georgia,serif;font-size:11px;color:rgba(241,236,223,0.55);letter-spacing:3px;text-transform:uppercase;vertical-align:top">Place</td>
<td style="padding:18px 28px 18px 0;font-family:'EB Garamond',Georgia,serif;font-size:16px;color:#F1ECDF;line-height:1.5">A private château<br><span style="color:rgba(241,236,223,0.6);font-size:14px">Cannes Californie</span></td>
</tr>
<tr><td colspan="2" style="border-top:1px solid rgba(241,236,223,0.08);line-height:0;font-size:0">&nbsp;</td></tr>
<tr>
<td style="padding:18px 0 18px 28px;font-family:'EB Garamond',Georgia,serif;font-size:11px;color:rgba(241,236,223,0.55);letter-spacing:3px;text-transform:uppercase;vertical-align:top">Doors</td>
<td style="padding:18px 28px 18px 0;font-family:'EB Garamond',Georgia,serif;font-size:15px;color:#F1ECDF;line-height:1.7">
<strong style="color:#d4b884">16:00</strong> Setters wave<br>
<strong style="color:#d4b884">17:00</strong> Main wave<br>
<strong style="color:#d4b884">18:00</strong> Hard close
</td>
</tr>
</table>
</td></tr>

<tr><td class="px-48" align="center" style="padding:24px 48px 0">
<p style="margin:0;font-family:'EB Garamond',Georgia,serif;font-size:13px;line-height:1.6;color:rgba(241,236,223,0.6);font-style:italic">The exact address will be sent 48 hours before the event by SMS.</p>
</td></tr>

<tr><td class="px-48" align="center" style="padding:32px 48px 48px">
<p style="margin:0;font-family:'EB Garamond',Georgia,serif;font-size:12px;color:rgba(241,236,223,0.55)">
Can't attend? <a href="${escapeHtml(declineUrl)}" style="color:#d4b884;text-decoration:underline">Let us know</a>
</p>
</td></tr>

<tr><td align="center" class="px-48" style="padding:32px 48px 40px;border-top:1px solid rgba(241,236,223,0.12);background-color:#0F0C09">
<p style="margin:0 0 8px;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:18px;color:#d4b884">Château Privé</p>
<p style="margin:0;font-family:'EB Garamond',Georgia,serif;font-size:10px;color:rgba(241,236,223,0.45);letter-spacing:3px;text-transform:uppercase;line-height:1.8">Cannes &middot; 15 May 2026 &middot; Privately Hosted</p>
</td></tr>

</table></td></tr></table></body></html>`;

  return { subject, text, html };
}

function renderPlusOneWelcomeSms({ name, primaryName, declineCode }) {
  const firstName = (name || '').split(' ')[0] || '';
  return `${firstName ? firstName + ', ' : ''}${primaryName} added you to Château Privé · 15 May · Cannes. Details in your email. Can't make it? ${shortUrl(declineCode)}`;
}
