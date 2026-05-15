// deploy-marker stripe-checkout-v1
// GET /api/payment/checkout?rid=recXXX
// Creates a Stripe Checkout Session for the given Airtable record and redirects to Stripe.
//
// Required ENV:
//   STRIPE_SECRET_KEY     - sk_test_... or sk_live_...
//   STRIPE_PRICE_AMOUNT   - optional, integer EUR cents (default 400000 = €4000)
//   STRIPE_CURRENCY       - optional, default 'eur'
//   PUBLIC_SITE_URL       - e.g. https://chateau-cannes.fraimit.com (for success/cancel redirects)
//   AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME

import { airtableGet, jsonError } from '../../_lib/messaging-utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const rid = url.searchParams.get('rid');
  const tier = url.searchParams.get('tier'); // optional tier override in EUR (e.g. "1000", "4000", "10000")
  if (!rid) return jsonError('Missing rid', 400);

  const required = ['STRIPE_SECRET_KEY', 'AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_NAME', 'PUBLIC_SITE_URL'];
  for (const k of required) {
    if (!env[k]) return jsonError('Missing env: ' + k, 500);
  }

  let record;
  try {
    record = await airtableGet(env, rid);
  } catch (err) {
    return jsonError('Record not found', 404);
  }
  const f = record.fields || {};

  // If already paid, just redirect to success page
  if (f['Has Paid'] === true) {
    return Response.redirect(`${env.PUBLIC_SITE_URL}/paid?already=1`, 302);
  }

  const email = (f['Email'] || '').trim();
  const name = f['Full Name'] || '';
  if (!email) return jsonError('Missing email on record', 400);

  // Resolve amount: tier query param (EUR) > env STRIPE_PRICE_AMOUNT (cents) > default €4000
  const allowedTiers = { '1000': 100000, '4000': 400000, '10000': 1000000 };
  let amount;
  if (tier && allowedTiers[tier]) {
    amount = allowedTiers[tier];
  } else {
    amount = parseInt(env.STRIPE_PRICE_AMOUNT || '400000', 10);
  }
  const currency = (env.STRIPE_CURRENCY || 'eur').toLowerCase();

  // Tier-aware product description
  const tierLabels = {
    '1000': 'Standard Concierge',
    '4000': 'Premium Concierge — priority entry, reserved seating',
    '10000': 'Patron — everything plus dinner table'
  };
  const productName = tier && tierLabels[tier]
    ? `Château Privé · ${tierLabels[tier].split(' — ')[0]} · 15 May 2026`
    : 'Château Privé · Concierge Access · 15 May 2026';
  const productDesc = tier && tierLabels[tier]
    ? (tierLabels[tier].includes('—') ? tierLabels[tier].split(' — ')[1] : 'Confirmed seat at Château Privé Cannes 2026')
    : 'Private invitation, secured spot at Château Privé Cannes 2026';

  const baseUrl = env.PUBLIC_SITE_URL.replace(/\/$/, '');
  const successUrl = baseUrl + '/paid?session_id={CHECKOUT_SESSION_ID}';
  const cancelUrl = baseUrl + '/?paycancel=1';

  // Build Stripe form-encoded body
  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('success_url', successUrl);
  params.append('cancel_url', cancelUrl);
  params.append('customer_email', email);
  params.append('client_reference_id', rid);
  params.append('metadata[record_id]', rid);
  params.append('metadata[name]', name);
  params.append('line_items[0][quantity]', '1');
  params.append('line_items[0][price_data][currency]', currency);
  params.append('line_items[0][price_data][unit_amount]', String(amount));
  params.append('line_items[0][price_data][product_data][name]', productName);
  params.append('line_items[0][price_data][product_data][description]', productDesc);
  params.append('payment_intent_data[metadata][record_id]', rid);
  if (tier) params.append('metadata[tier]', tier);

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  const data = await res.json();
  if (!res.ok) {
    return jsonError('Stripe error: ' + (data.error?.message || res.status), 500);
  }

  return Response.redirect(data.url, 302);
}
