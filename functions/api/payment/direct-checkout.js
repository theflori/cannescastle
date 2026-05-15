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

// Allowed origins for cross-origin form submission (Frontend page → Dashboard endpoint).
// Add additional public sites here if you serve /buy from more places.
const ALLOWED_ORIGINS = [
  'https://chateau-cannes.fraimit.com',
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

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function isValidEmail(s) {
  if (!s || typeof s !== 'string') return false;
  // Pragmatic check — actual validation happens in Stripe Checkout anyway
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

// Wrap json helpers so we can add CORS headers to every response
function withCors(response, origin) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';

  // Required env
  const required = ['STRIPE_SECRET_KEY', 'AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_NAME', 'PUBLIC_SITE_URL'];
  for (const k of required) {
    if (!env[k]) return withCors(jsonError('Server misconfigured: missing ' + k, 500), origin);
  }

  let body;
  try { body = await request.json(); }
  catch { return withCors(jsonError('Invalid JSON', 400), origin); }

  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const phone = (body.phone || '').trim();
  const instagram = (body.instagram || '').trim().replace(/^@/, '');
  const referredBy = (body.referredBy || '').trim();

  // Validation
  if (!name || name.length < 2) return withCors(jsonError('Please enter your name', 400), origin);
  if (!isValidEmail(email)) return withCors(jsonError('Please enter a valid email', 400), origin);

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
    return withCors(jsonError('Could not save your details: ' + err.message, 500), origin);
  }

  const recordId = createdRecord.id;
  if (!recordId) return withCors(jsonError('Airtable did not return a record id', 500), origin);

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
    console.error('[direct-checkout] Stripe error:', stripeData);
    return withCors(jsonError('Payment session could not be created. Please try again or contact us.', 500), origin);
  }

  return withCors(jsonOk({
    url: stripeData.url,
    recordId: recordId
  }), origin);
}
