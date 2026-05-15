// deploy-marker r-code-v1
// GET /r/{code}
//
// Short-URL handler. Resolves a code (decline code or plus-one code) and
// redirects to the appropriate page on this site:
//   - matched Decline Code  → /decline.html?code={code}
//   - matched Plus One Code → /plus-one.html?code={code}
//   - no match              → /  (graceful fallback)

import { airtableGetByCode } from '../_lib/messaging-utils.js';

export async function onRequestGet(context) {
  const { params, request, env } = context;
  const code = (params.code || '').trim();
  const baseUrl = new URL(request.url).origin;

  if (!code) {
    return Response.redirect(baseUrl + '/', 302);
  }

  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID || !env.AIRTABLE_TABLE_NAME) {
    return new Response('Server misconfigured', { status: 500 });
  }

  let record;
  try {
    record = await airtableGetByCode(env, code);
  } catch (err) {
    console.error('[r/code] lookup failed', err.message);
    return Response.redirect(baseUrl + '/', 302);
  }

  if (!record) {
    // No match — soft-fail to home rather than 404 (better UX for old/wrong links)
    return Response.redirect(baseUrl + '/', 302);
  }

  if (record.kind === 'decline') {
    return Response.redirect(baseUrl + '/decline.html?code=' + encodeURIComponent(code), 302);
  }
  if (record.kind === 'plus-one') {
    return Response.redirect(baseUrl + '/plus-one.html?code=' + encodeURIComponent(code), 302);
  }

  return Response.redirect(baseUrl + '/', 302);
}
