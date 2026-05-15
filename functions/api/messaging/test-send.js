// deploy-marker test-send-v1
// POST /api/messaging/test-send
// Body: { type: 'confirmation'|'waitlist'|'reminder', email: string, phone?: string }
//
// Sends a TEST email/SMS to the given address with mock data.
// Does NOT touch Airtable — no records read or written.
// Use this to preview templates without affecting real guests.

import { sendEmail, sendSms, normalizePhone, jsonError, jsonOk } from '../../_lib/messaging-utils.js';
import {
  renderConfirmationEmail, renderConfirmationSms,
  renderWaitlistEmail, renderWaitlistSms,
  render24hReminderEmail, render24hReminderSms,
  renderListClosedEmail
} from '../../_lib/templates.js';

function buildQrImageUrl(qrCode) {
  const payload = encodeURIComponent(qrCode);
  return `https://api.qrserver.com/v1/create-qr-code/?size=400x400&ecc=H&margin=10&data=${payload}`;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.RESEND_API_KEY) return jsonError('RESEND_API_KEY not set', 500);

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const type = body.type;
  const email = (body.email || '').trim();
  const phone = body.phone ? normalizePhone(body.phone) : null;
  const overrideRid = (body.recordId || '').trim();

  if (!['confirmation', 'waitlist', 'reminder', 'list-closed'].includes(type)) {
    return jsonError("type must be 'confirmation', 'waitlist', 'reminder', or 'list-closed'", 400);
  }
  if (!email) return jsonError('Missing email', 400);

  // Mock data — clearly marked so a test send is recognizable
  const mockName = 'Test Recipient';
  const mockDeclineCode = 'TESTDECL';
  const mockPlusOneCode = 'TESTPLUS';
  const mockQrCode = '00000000-test-test-test-000000000000';

  // Stripe pay URL: use real Record ID if provided so the link actually works,
  // otherwise fall back to rec_TEST (link will hit "Record not found" — expected).
  const dashBase = (env.DASHBOARD_PUBLIC_URL || env.PUBLIC_SITE_URL || '').replace(/\/$/, '');
  const ridForLink = overrideRid || 'rec_TEST';
  const mockPayUrl = (env.STRIPE_SECRET_KEY && dashBase)
    ? `${dashBase}/api/payment/checkout?rid=${encodeURIComponent(ridForLink)}&tier=4000`
    : '';

  let emailContent, smsContent;
  try {
    if (type === 'confirmation') {
      emailContent = renderConfirmationEmail({
        name: mockName,
        declineCode: mockDeclineCode,
        plusOneCode: mockPlusOneCode
      });
      smsContent = renderConfirmationSms({ name: mockName, declineCode: mockDeclineCode });
    } else if (type === 'waitlist') {
      emailContent = renderWaitlistEmail({
        name: mockName,
        declineCode: mockDeclineCode,
        payUrl: mockPayUrl
      });
      smsContent = renderWaitlistSms({ name: mockName, declineCode: mockDeclineCode });
    } else if (type === 'list-closed') {
      emailContent = renderListClosedEmail({
        name: mockName,
        payUrl: mockPayUrl
      });
      smsContent = null; // no SMS for list-closed (email-only)
    } else { // reminder
      emailContent = render24hReminderEmail({
        name: mockName,
        declineCode: mockDeclineCode,
        qrCodeImageUrl: buildQrImageUrl(mockQrCode)
      });
      smsContent = render24hReminderSms({ name: mockName, declineCode: mockDeclineCode });
    }
  } catch (err) {
    return jsonError('Template rendering failed: ' + err.message, 500);
  }

  // Tag the subject so it's obvious it's a test
  const subject = `[TEST] ${emailContent.subject}`;

  const result = { type, emailSent: false, smsSent: false, errors: [] };

  try {
    await sendEmail(env, { to: email, subject, html: emailContent.html, text: emailContent.text });
    result.emailSent = true;
  } catch (err) {
    result.errors.push({ channel: 'email', message: err.message });
  }

  if (smsContent && phone && env.TWILIO_ACCOUNT_SID) {
    try {
      await sendSms(env, { to: phone, body: `[TEST] ${smsContent}` });
      result.smsSent = true;
    } catch (err) {
      result.errors.push({ channel: 'sms', message: err.message });
    }
  }

  return jsonOk(result);
}
