// deploy-marker healthcheck-diag-v3
// GET /api/healthcheck
// Public diagnostics — lists which env vars and bindings are configured.
// Never reveals secret values, only presence/absence.

export async function onRequestGet(context) {
  const { env } = context;

  const expectedEnvVars = [
    'SESSION_SECRET',
    'DASHBOARD_PASSWORD',
    'STAFF_PASSWORD',
    'AIRTABLE_TOKEN',
    'AIRTABLE_BASE_ID',
    'AIRTABLE_TABLE_NAME',
    'APIFY_TOKEN',
    'RESEND_API_KEY',
    'RESEND_FROM',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER',
    // Payment-related (renamed from /api/stripe/ to /api/payment/ to avoid filter conflicts)
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'PUBLIC_SITE_URL',         // used by checkout for success/cancel redirects
    'DASHBOARD_PUBLIC_URL'     // used by waitlist email to build payUrl
  ];

  const expectedBindings = ['ASSETS']; // R2 bucket

  const envStatus = {};
  for (const k of expectedEnvVars) {
    envStatus[k] = typeof env[k] === 'string' && env[k].length > 0 ? 'set' : 'MISSING';
  }

  const bindingStatus = {};
  for (const k of expectedBindings) {
    bindingStatus[k] = env[k] ? 'bound' : 'MISSING';
  }

  return new Response(JSON.stringify({
    ok: true,
    timestamp: new Date().toISOString(),
    message: 'healthcheck — if you see this, the build deployed',
    env: envStatus,
    bindings: bindingStatus
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}
