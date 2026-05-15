// deploy-marker phone-apply-v1
// POST /api/messaging/phone-cleanup-apply
// Body: { updates: [ { id, cleaned } ] }
// Applies the cleaned phone values to Airtable.

import { airtablePatch, jsonError, jsonOk, sanitizeE164 } from '../../_lib/messaging-utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.AIRTABLE_TOKEN) return jsonError('Missing AIRTABLE_TOKEN', 500);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const updates = Array.isArray(body.updates) ? body.updates : [];
  if (updates.length === 0) return jsonError('No updates provided', 400);
  if (updates.length > 500) return jsonError('Too many updates (max 500)', 400);

  let applied = 0;
  const failed = [];

  for (const u of updates) {
    if (!u.id || typeof u.cleaned !== 'string') {
      failed.push({ id: u.id, reason: 'invalid input' });
      continue;
    }
    try {
      // Final sanitization safety net: ensure value stored in Airtable is strict E.164
      const sanitized = sanitizeE164(u.cleaned) || u.cleaned;
      await airtablePatch(env, u.id, { 'Phone': sanitized });
      applied++;
    } catch (err) {
      failed.push({ id: u.id, reason: err.message });
    }
  }

  return jsonOk({ applied, failed });
}
