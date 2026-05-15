// deploy-marker direct-checkout-v1
// POST /api/payment/direct-checkout
//
// Public endpoint for the dedicated "buy a Concierge seat directly" page.
// Flow: form submits here → creates an Airtable record → creates a Stripe
// Checkout Session → returns { url } so the client redirects to Stripe.
//
// On successful payment, the existing /api/payment/webhook handler will
// mark Has Paid=true, set Messaging Status=Approved, generate codes, and
// send the confirmation + QR access emails automatically.
//
// Body: { name, email, phone?, instagram?, referredBy? }
//
// Required ENV:
//   STRIPE_SECRET_KEY
//   PUBLIC_SITE_URL          — used for success/cancel URLs
//   AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME
//   STRIPE_PRICE_AMOUNT      — optional, default 400000 cents (€4000)
//   STRIPE_CURRENCY          — optional, default 'eur'

import { airtableCreate, jsonError, jsonOk } from '../../_lib/messaging-utils.js';

const SOURCE_TAG = 'direct-paid';

function isValidEmail(s) {
  if (!s || typeof s !== 'string') return false;
  // Pragmatic check — actual validation happens in Stripe Checkout anyway
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Required env
  const required = ['STRIPE_SECRET_KEY', 'AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_NAME', 'PUBLIC_SITE_URL'];
  for (const k of required) {
    if (!env[k]) return jsonError('Server misconfigured: missing ' + k, 500);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON', 400); }

  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const phone = (body.phone || '').trim();
  const instagram = (body.instagram || '').trim().replace(/^@/, '');
  const referredBy = (body.referredBy || '').trim();

  // Validation
  if (!name || name.length < 2) return jsonError('Please enter your name', 400);
  if (!isValidEmail(email)) return jsonError('Please enter a valid email', 400);

  // 1. Create Airtable record — UNPAID for now. Webhook flips it to paid + approved.
  // Tag with 'direct-paid' so you can distinguish these from regular signups.
  let createdRecord;
  try {
    const fields = {
      'Full Name': name,
      'Email': email,
      'Tags': [SOURCE_TAG]
    };
    if (phone)      fields['Phone'] = phone;
    if (instagram)  fields['Instagram'] = instagram;
    if (referredBy) fields['Referred By'] = referredBy;

    createdRecord = await airtableCreate(env, fields);
  } catch (err) {
    return jsonError('Could not save your details: ' + err.message, 500);
  }

  const recordId = createdRecord.id;
  if (!recordId) return jsonError('Airtable did not return a record id', 500);

  // 2. Build Stripe Checkout Session (Premium / Concierge tier)
  const amount = parseInt(env.STRIPE_PRICE_AMOUNT || '400000', 10);
  const currency = (env.STRIPE_CURRENCY || 'eur').toLowerCase();
  const baseUrl = env.PUBLIC_SITE_URL.replace(/\/$/, '');
  const successUrl = baseUrl + '/paid?session_id={CHECKOUT_SESSION_ID}';
  const cancelUrl = baseUrl + '/buy?cancelled=1';

  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('success_url', successUrl);
  params.append('cancel_url', cancelUrl);
  params.append('customer_email', email);
  params.append('client_reference_id', recordId);
  params.append('metadata[record_id]', recordId);
  params.append('metadata[name]', name);
  params.append('metadata[source]', SOURCE_TAG);
  params.append('metadata[tier]', '4000');
  params.append('line_items[0][quantity]', '1');
  params.append('line_items[0][price_data][currency]', currency);
  params.append('line_items[0][price_data][unit_amount]', String(amount));
  params.append('line_items[0][price_data][product_data][name]', 'Château Privé · Concierge Access · 15 May 2026');
  params.append('line_items[0][price_data][product_data][description]', 'Private invitation, secured spot at Château Privé Cannes 2026');
  params.append('payment_intent_data[metadata][record_id]', recordId);
  params.append('payment_intent_data[metadata][source]', SOURCE_TAG);

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  const stripeData = await stripeRes.json();
  if (!stripeRes.ok) {
    // Record is already in Airtable — leave it, mark it so you can see in the dashboard
    console.error('[direct-checkout] Stripe error:', stripeData);
    return jsonError('Payment session could not be created. Please try again or contact us.', 500);
  }

  return jsonOk({
    url: stripeData.url,
    recordId: recordId
  });
}
