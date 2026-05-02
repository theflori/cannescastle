// Cloudflare Pages Function: POST /webhook
// Receives webhook from Formspree
// 1. Saves to Airtable
// 2. Sends custom HTML confirmation email via Resend

export async function onRequestPost({ request, env }) {
  try {
    let raw;
    const contentType = (request.headers.get('content-type') || '').toLowerCase();

    if (contentType.includes('application/json')) {
      raw = await request.json();
    } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      raw = Object.fromEntries(formData);
    } else {
      const text = await request.text();
      try {
        raw = JSON.parse(text);
      } catch {
        const params = new URLSearchParams(text);
        raw = Object.fromEntries(params);
      }
    }

    console.log('Received payload:', JSON.stringify(raw));

    const fields = raw.data || raw.fields || raw.payload || raw.submission || raw;

    const data = {
      fullName: pickField(fields, ['name', 'Full Name', 'fullName', 'full_name', 'full-name', 'Name']),
      email: pickField(fields, ['email', 'Email', '_replyto']),
      phone: pickField(fields, ['phone', 'Phone', 'tel', 'telephone']),
      company: pickField(fields, ['company', 'Company', 'Company / Industry', 'company_industry', 'industry']),
      instagram: pickField(fields, ['instagram', 'Instagram', 'Instagram / Social', 'social', 'ig'])
    };

    Object.keys(data).forEach(k => {
      data[k] = (data[k] || '').toString().trim();
    });
    if (data.instagram) data.instagram = data.instagram.replace(/^@/, '');
    if (data.email) data.email = data.email.toLowerCase();

    const errors = [];

    // 1. Save to Airtable
    if (data.email) {
      try {
        const airtableRes = await fetch(
          `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AIRTABLE_TABLE_NAME)}`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              fields: {
                'Full Name': data.fullName,
                'Email': data.email,
                'Phone': data.phone,
                'Company / Industry': data.company,
                'Instagram': data.instagram,
                'Source': 'Web Application',
                'Status': 'Pending'
              }
            })
          }
        );
        if (!airtableRes.ok) {
          const errText = await airtableRes.text();
          console.error('Airtable error:', airtableRes.status, errText);
          errors.push('airtable');
        }
      } catch (e) {
        console.error('Airtable fetch failed:', e.message);
        errors.push('airtable-fetch');
      }
    } else {
      errors.push('no-email');
    }

    // 2. Send confirmation email via Resend
    if (data.email) {
      try {
        const emailHtml = buildConfirmationEmail(data.fullName);
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: env.FROM_EMAIL || 'Château Privé <onboarding@resend.dev>',
            to: data.email,
            subject: 'Your request has been received',
            html: emailHtml,
            reply_to: env.REPLY_TO_EMAIL || 'events@fraimit.com'
          })
        });
        if (!resendRes.ok) {
          const errText = await resendRes.text();
          console.error('Resend error:', resendRes.status, errText);
          errors.push('resend');
        }
      } catch (e) {
        console.error('Resend fetch failed:', e.message);
        errors.push('resend-fetch');
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      processed: !!data.email,
      errors: errors,
      received: Object.keys(fields)
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (e) {
    console.error('Webhook fatal error:', e.message);
    return new Response(JSON.stringify({
      ok: false,
      error: e.message
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestGet() {
  return new Response(JSON.stringify({
    ok: true,
    message: 'Webhook is alive. Send POST requests here.'
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function pickField(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
      return obj[key];
    }
  }
  const lowerKeys = keys.map(k => k.toLowerCase());
  for (const objKey of Object.keys(obj)) {
    if (lowerKeys.includes(objKey.toLowerCase())) {
      const value = obj[objKey];
      if (value !== undefined && value !== null && value !== '') return value;
    }
  }
  return '';
}

function buildConfirmationEmail(fullName) {
  const name = escapeHtml(fullName || 'there');
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>Your request has been received — Château Privé</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=EB+Garamond:wght@400&display=swap" rel="stylesheet">
<style>
@media only screen and (max-width: 620px) {
.container { width: 100% !important; }
.px-56 { padding-left: 28px !important; padding-right: 28px !important; }
.h1 { font-size: 44px !important; }
}
body { margin: 0; padding: 0; }
</style>
</head>
<body style="margin:0; padding:0; background-color:#0F0C09; font-family:'EB Garamond', Georgia, 'Times New Roman', serif; color:#F1ECDF;">
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#0F0C09;">
Your request has been received. We'll notify you once a decision has been made.
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0F0C09" style="background-color:#0F0C09;">
<tr>
<td align="center" style="padding:64px 16px;">

<table role="presentation" class="container" width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px; max-width:520px;">

<tr>
<td align="center" class="px-56" style="padding:0 56px 56px 56px;">
<p style="margin:0; font-family:'Cormorant Garamond', Georgia, serif; font-style:italic; font-weight:400; font-size:18px; color:#d4b884; letter-spacing:0.5px;">
Château Privé
</p>
</td>
</tr>

<tr>
<td class="px-56" align="left" style="padding:0 56px;">

<p style="margin:0 0 32px 0; font-family:'EB Garamond', Georgia, serif; font-size:10px; color:rgba(241,236,223,0.5); letter-spacing:4px; text-transform:uppercase;">
Request Received
</p>

<h1 class="h1" style="margin:0 0 48px 0; font-family:'Cormorant Garamond', Georgia, serif; font-style:italic; font-weight:300; font-size:54px; line-height:1.05; color:#F1ECDF; letter-spacing:-0.5px;">
Thank you.
</h1>

<p style="margin:0 0 22px 0; font-family:'EB Garamond', Georgia, serif; font-size:17px; line-height:1.7; color:#F1ECDF;">
Hi ${name},
</p>

<p style="margin:0 0 22px 0; font-family:'EB Garamond', Georgia, serif; font-size:17px; line-height:1.7; color:rgba(241,236,223,0.85);">
Thank you for your request.
</p>

<p style="margin:0 0 22px 0; font-family:'EB Garamond', Georgia, serif; font-size:17px; line-height:1.7; color:rgba(241,236,223,0.85);">
Your submission is currently under review. Due to limited capacity, access is curated and not guaranteed.
</p>

<p style="margin:0 0 56px 0; font-family:'EB Garamond', Georgia, serif; font-size:17px; line-height:1.7; color:rgba(241,236,223,0.85);">
We will notify you once a final decision has been made.
</p>

<p style="margin:0; font-family:'EB Garamond', Georgia, serif; font-size:17px; line-height:1.7; color:#F1ECDF;">
Best regards,<br/>
<span style="color:rgba(241,236,223,0.6);">Guest Management Team</span>
</p>

</td>
</tr>

<tr>
<td class="px-56" style="padding:80px 56px 0 56px;">
<table role="presentation" align="left" cellpadding="0" cellspacing="0" border="0">
<tr><td width="32" height="1" bgcolor="#B8965A" style="background-color:#B8965A; line-height:1px; font-size:0;">&nbsp;</td></tr>
</table>
</td>
</tr>

<tr>
<td class="px-56" align="left" style="padding:24px 56px 0 56px;">
<p style="margin:0; font-family:'EB Garamond', Georgia, serif; font-size:10px; color:rgba(241,236,223,0.4); letter-spacing:3px; text-transform:uppercase; line-height:1.8;">
Cannes &middot; MMXXVI &middot; Privately Hosted
</p>
</td>
</tr>

<tr>
<td class="px-56" align="left" style="padding:32px 56px 0 56px;">
<p style="margin:0; font-family:'EB Garamond', Georgia, serif; font-size:11px; line-height:1.6; color:rgba(241,236,223,0.35);">
This message is confidential and intended only for the recipient.<br/>
If you have received it in error, please disregard and delete.
</p>
</td>
</tr>

</table>

</td>
</tr>
</table>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
