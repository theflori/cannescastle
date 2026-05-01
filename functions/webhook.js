// Cloudflare Pages Function: POST /webhook
// Receives webhook from Formspree on every form submission
// 1. Saves to Airtable
// 2. Sends custom HTML confirmation email via Resend

export async function onRequestPost({ request, env }) {
  try {
    // Parse incoming webhook payload — handles all formats Formspree might send
    let raw;
    const contentType = (request.headers.get('content-type') || '').toLowerCase();

    if (contentType.includes('application/json')) {
      raw = await request.json();
    } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      raw = Object.fromEntries(formData);
    } else {
      // Fallback: try JSON, then form data
      const text = await request.text();
      try {
        raw = JSON.parse(text);
      } catch {
        const params = new URLSearchParams(text);
        raw = Object.fromEntries(params);
      }
    }

    console.log('Received payload:', JSON.stringify(raw));

    // Formspree wraps fields in different shapes depending on plan/setup
    // Try common nested locations
    const fields = raw.data || raw.fields || raw.payload || raw.submission || raw;

    // Extract values — try many possible field name variations
    const data = {
      fullName: pickField(fields, ['name', 'Full Name', 'fullName', 'full_name', 'full-name', 'Name']),
      email: pickField(fields, ['email', 'Email', '_replyto']),
      phone: pickField(fields, ['phone', 'Phone', 'tel', 'telephone']),
      company: pickField(fields, ['company', 'Company', 'Company / Industry', 'company_industry', 'industry']),
      instagram: pickField(fields, ['instagram', 'Instagram', 'Instagram / Social', 'social', 'ig'])
    };

    // Clean values
    Object.keys(data).forEach(k => {
      data[k] = (data[k] || '').toString().trim();
    });
    if (data.instagram) data.instagram = data.instagram.replace(/^@/, '');
    if (data.email) data.email = data.email.toLowerCase();

    // Always respond 200 to Formspree, even on partial errors
    // Otherwise Formspree marks the webhook as broken
    const errors = [];

    // 1. Save to Airtable (only if we have at least an email)
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
      console.warn('No email found in payload — skipping Airtable + email');
      errors.push('no-email');
    }

    // 2. Send confirmation email
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
            subject: 'Application received',
            html: emailHtml,
            reply_to: env.REPLY_TO_EMAIL || 'hallo@theflori.com'
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

    // Always return 200 so Formspree is happy
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
    console.error('Webhook fatal error:', e.message, e.stack);
    // Return 200 even on fatal errors so Formspree doesn't disable the webhook
    return new Response(JSON.stringify({
      ok: false,
      error: e.message
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// GET handler — useful for debugging "is the worker alive"
export async function onRequestGet() {
  return new Response(JSON.stringify({
    ok: true,
    message: 'Webhook is alive. Send POST requests here.'
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Helper: try multiple field names to find the value
function pickField(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
      return obj[key];
    }
  }
  // Try case-insensitive match as fallback
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
  const firstName = (fullName || '').split(' ')[0] || 'there';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Application received</title></head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">

<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#0a0a0a;">
<tr><td align="center" style="padding:40px 20px;">

<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="540" style="max-width:540px;">

<tr><td align="center" style="padding:48px 40px 80px 40px;">
<div style="font-size:11px;letter-spacing:0.4em;color:#8a6d3b;margin-bottom:6px;">CHÂTEAU PRIVÉ</div>
<div style="font-size:11px;letter-spacing:0.3em;color:rgba(255,255,255,0.4);">CANNES — MMXXVI</div>
</td></tr>

<tr><td style="padding:0 40px 28px 40px;">
<div style="font-size:14px;line-height:1.7;color:rgba(255,255,255,0.7);">${escapeHtml(firstName)},</div>
</td></tr>

<tr><td style="padding:0 40px 32px 40px;">
<div style="font-size:26px;line-height:1.3;font-weight:400;color:#ffffff;letter-spacing:-0.01em;">Your application has been received.</div>
</td></tr>

<tr><td style="padding:0 40px 48px 40px;">
<div style="font-size:14px;line-height:1.8;color:rgba(255,255,255,0.7);">
Applications are reviewed personally. You will hear from us within 72 hours by email — whether your invitation is confirmed or not.
<br><br>
Until then, no follow-up needed.
</div>
</td></tr>

<tr><td style="padding:0 40px 48px 40px;">
<div style="border-top:0.5px solid rgba(255,255,255,0.15);border-bottom:0.5px solid rgba(255,255,255,0.15);padding:32px 0;text-align:center;">
<div style="font-size:11px;letter-spacing:0.3em;color:rgba(255,255,255,0.4);margin-bottom:12px;">PRIVATE INVITATION</div>
<div style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.6);">Cannes — 16 May 2026</div>
</div>
</td></tr>

<tr><td style="padding:32px 40px;">
<div style="font-size:10px;line-height:1.8;color:rgba(255,255,255,0.4);letter-spacing:0.05em;">
For changes or questions, reply to this email.
</div>
<div style="margin-top:24px;font-size:9px;letter-spacing:0.3em;color:rgba(255,255,255,0.3);">CHÂTEAU PRIVÉ — CANNES — MMXXVI</div>
</td></tr>

</table>
</td></tr>
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
