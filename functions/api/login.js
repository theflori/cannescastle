// deploy-marker login-staff-v1
// POST /api/login with { password }
// Accepts either DASHBOARD_PASSWORD (full admin) or STAFF_PASSWORD (scanner-only).
// On success, sets cp_session cookie (30 days). The payload includes a `role`
// field — checked by /api/checkin to deny admin-only access to staff sessions,
// and by the middleware on subpath gating.

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DASHBOARD_PASSWORD || !env.SESSION_SECRET) {
    return jsonError('Server not configured. Missing DASHBOARD_PASSWORD or SESSION_SECRET.', 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const submittedPassword = (body.password || '').trim();

  // Determine role by which password matched
  let role = null;
  if (constantTimeEqual(submittedPassword, env.DASHBOARD_PASSWORD)) {
    role = 'admin';
  } else if (env.STAFF_PASSWORD && constantTimeEqual(submittedPassword, env.STAFF_PASSWORD)) {
    role = 'staff';
  }

  if (!role) {
    await new Promise(r => setTimeout(r, 800));
    return jsonError('Invalid password', 401);
  }

  const payload = btoa(JSON.stringify({
    role,
    iat: Date.now(),
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000  // 30 days
  }));
  const signature = await hmac(payload, env.SESSION_SECRET);
  const token = `${payload}.${signature}`;

  return new Response(JSON.stringify({ ok: true, role }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `cp_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
    }
  });
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}
