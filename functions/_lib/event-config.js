// deploy-marker event-config-v1
// Single source of truth for event details. Hardcoded for the May 2026 Cannes event.
// When we move to multi-event later, this becomes a lookup table or Airtable read.

export const EVENT = {
  name: 'Château Privé',
  dateLabel: 'Friday, 15 May 2026',
  dateIso: '2026-05-15',
  doorsOpen: '16:00',
  mainWave: '17:00',
  closing: '04:00',
  timezone: 'Europe/Paris',

  // Location revealed in confirmation email — keep precise
  location: {
    name: 'Cannes Californie',
    addressLine1: '[Address revealed in confirmation email]',
    city: 'Cannes',
    country: 'France',
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Cannes+Californie'
  },

  dressCode: 'Refined evening — elegance over formality. No logos, no streetwear.',

  // Used as fallback if env.PUBLIC_SITE_URL is missing
  dashboardUrl: 'https://cannes-dash.pages.dev'
};

// ============== LIST-CLOSED / PREMIUM UPGRADE CONFIG ==============
// Reads from Cloudflare Env Variables. Set in Pages → Settings → Env Variables:
//
//   LIST_CLOSED_AT       — ISO datetime, e.g. "2026-05-15T14:00:00+02:00"
//                          (when set + in the past, list is considered CLOSED)
//   PREMIUM_PRICE_EUR    — optional, default 4000
//   PREMIUM_TIER_KEY     — optional, default "4000" (matches checkout tiers)
//
// To activate: set LIST_CLOSED_AT in Cloudflare. To deactivate: unset or push it to the future.

export function getListClosingTime(env) {
  if (!env.LIST_CLOSED_AT) return null;
  const t = new Date(env.LIST_CLOSED_AT);
  if (isNaN(t.getTime())) return null;
  return t;
}

export function isListClosed(env, now) {
  const t = getListClosingTime(env);
  if (!t) return false;
  return (now || new Date()) >= t;
}

export function getPremiumPriceEur(env) {
  return parseInt(env.PREMIUM_PRICE_EUR || '4000', 10);
}

export function getPremiumTierKey(env) {
  return env.PREMIUM_TIER_KEY || '4000';
}

// Build the per-guest premium checkout URL.
// Uses the existing /api/payment/checkout?rid=...&tier=... endpoint.
// IMPORTANT: this endpoint lives on the DASHBOARD project (cannes-dash.pages.dev),
// not on the public landing site (chateau-cannes.fraimit.com). So we prefer
// DASHBOARD_PUBLIC_URL — only fall back to PUBLIC_SITE_URL if both are missing.
export function buildPremiumCheckoutUrl(env, recordId) {
  const base = (env.DASHBOARD_PUBLIC_URL || env.PUBLIC_SITE_URL || EVENT.dashboardUrl).replace(/\/$/, '');
  const tier = getPremiumTierKey(env);
  return `${base}/api/payment/checkout?rid=${encodeURIComponent(recordId)}&tier=${encodeURIComponent(tier)}`;
}

// Helper to get the dashboard URL with fallback chain
export function getDashboardUrl(env) {
  return (env.PUBLIC_SITE_URL || env.DASHBOARD_PUBLIC_URL || EVENT.dashboardUrl).replace(/\/$/, '');
}
