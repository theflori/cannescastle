// deploy-marker 1778400849
// POST /api/plus-one/submit
// Body: { token, firstName, lastName, email, phone }
//
// 1. Validate token, ensure plus-one not yet used
// 2. Create new Airtable record for the plus-one
//    - Status: Approved (auto-approved as guest of approved primary)
//    - Messaging Status: Approved
//    - Plus One Of: links back to primary
// 3. Update primary record:
//    - Plus One Used: true
// 4. Generate decline token for plus-one, send their welcome email + SMS

import { signToken, verifyToken, airtableGet, airtablePatch, airtableCreate, sendEmail, sendSms, normalizePhone, jsonError, jsonOk, getBaseUrl } from '../../_lib/messaging-utils.js';
import { renderPlusOneWelcomeEmail, renderPlusOneWelcomeSms } from '../../_lib/templates.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SESSION_SECRET || !env.AIRTABLE_TOKEN || !env.RESEND_API_KEY) {
    return jsonError('Server misconfigured', 500);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const { token, firstName, lastName, email, phone } = body;

  if (!token) return jsonError('Missing token', 400);
  if (!firstName || !lastName) return jsonError('First and last name required', 400);
  if (!email || !email.includes('@')) return jsonError('Valid email required', 400);

  const payload = await verifyToken(token, env.SESSION_SECRET, 'plusone');
  if (!payload || !payload.rid) return jsonError('Invalid token', 403);

  try {
    // 1. Read primary, check token + plus-one-used
    const primary = await airtableGet(env, payload.rid);
    const pf = primary.fields || {};

    const storedToken = pf['Plus One Token'] || '';
    if (storedToken && storedToken !== token) {
      return jsonError('Token superseded', 403);
    }

    if (pf['Plus One Used']) {
      return jsonError('Plus-one already added for this invitation', 409);
    }

    const primaryName = pf['Full Name'] || 'Your host';
    const fullName = `${firstName} ${lastName}`.trim();
    const normalizedPhone = normalizePhone(phone);

    // 2. Create plus-one record
    const newRecord = await airtableCreate(env, {
      'Full Name': fullName,
      'Email': email,
      'Phone': normalizedPhone,
      'Status': 'Approved',
      'Messaging Status': 'Approved',
      'Source': 'Plus-One',
      'Plus One Of': [payload.rid],
      'Last Message Sent At': new Date().toISOString()
    });

    const newId = newRecord.id;

    // 3. Generate decline token for plus-one
    const declineToken = await signToken(
      { rid: newId, p: 'decline', iat: Date.now() },
      env.SESSION_SECRET
    );
    const baseUrl = getBaseUrl(request);
    const declineUrl = `${baseUrl}/decline?token=${encodeURIComponent(declineToken)}`;

    // Save decline token to plus-one record
    await airtablePatch(env, newId, {
      'Decline Token': declineToken
    });

    // 4. Mark primary as plus-one-used
    await airtablePatch(env, payload.rid, {
      'Plus One Used': true
    });

    // 5. Send welcome email to plus-one
    let emailSent = false;
    try {
      const emailContent = renderPlusOneWelcomeEmail({
        name: fullName,
        primaryName,
        declineUrl
      });
      await sendEmail(env, {
        to: email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text
      });
      emailSent = true;
    } catch (err) {
      console.error('Plus-one welcome email failed:', err.message);
    }

    // 6. Send SMS to plus-one (if phone + Twilio configured)
    let smsSent = false;
    if (normalizedPhone && env.TWILIO_ACCOUNT_SID) {
      try {
        const smsBody = renderPlusOneWelcomeSms({
          name: fullName,
          primaryName,
          declineUrl
        });
        await sendSms(env, { to: normalizedPhone, body: smsBody });
        smsSent = true;
      } catch (err) {
        console.error('Plus-one SMS failed:', err.message);
      }
    }

    return jsonOk({
      created: newId,
      emailSent,
      smsSent
    });
  } catch (err) {
    return jsonError('Submission failed: ' + err.message, 500);
  }
}
