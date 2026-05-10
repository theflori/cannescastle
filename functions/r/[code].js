// deploy-marker 1778406072
// GET /r/{code}
// Looks up the code in Airtable, redirects to /decline?id={recordId} or /plus-one?id={recordId}

import { airtableGetByCode } from '../_lib/messaging-utils.js';

export async function onRequestGet(context) {
  const { params, env } = context;
  const code = params.code;

  if (!code || typeof code !== 'string' || code.length < 4 || code.length > 12) {
    return notFoundHtml();
  }

  try {
    const result = await airtableGetByCode(env, code);
    if (!result) return notFoundHtml();

    const recordId = result.record.id;
    const target = result.codeType === 'decline'
      ? `/decline?id=${recordId}`
      : `/plus-one?id=${recordId}`;

    return Response.redirect(`https://${context.request.headers.get('host')}${target}`, 302);
  } catch (err) {
    console.error('Shortener error:', err.message);
    return notFoundHtml();
  }
}

function notFoundHtml() {
  return new Response(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Link not found · Château Privé</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;1,300&family=EB+Garamond:wght@400&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0F0C09;color:#F1ECDF;font-family:'EB Garamond',Georgia,serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{max-width:420px;text-align:center;padding:48px 32px;background:#1A1612;border:1px solid rgba(241,236,223,0.12)}
.brand{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:24px;color:#d4b884;margin-bottom:6px}
.meta{font-size:10px;letter-spacing:3px;text-transform:uppercase;color:rgba(241,236,223,0.55);margin-bottom:40px}
h1{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;font-size:36px;color:#d4b884;margin-bottom:20px}
p{font-size:14px;color:rgba(241,236,223,0.7);line-height:1.6}
</style></head><body>
<div class="card">
  <div class="brand">Château Privé</div>
  <div class="meta">Cannes · MMXXVI</div>
  <h1>Link not found</h1>
  <p>This link doesn't appear to be valid. If you believe this is an error, please contact the host directly.</p>
</div>
</body></html>`, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
