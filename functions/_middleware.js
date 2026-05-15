// deploy-marker middleware-role-v1
// Auth middleware:
// - Public routes pass through
// - Authenticated users (role=admin or role=staff) need a valid cp_session
// - Staff users are limited to /scan/* and /api/checkin
// - Admin users have full access

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  try {
    // === Public routes (no auth) ===
    const publicRoutes = ['/login', '/api/login', '/api/logout', '/login.html', '/api/healthcheck',
      '/buy', '/buy.html', '/paid', '/paid.html'];
    if (publicRoutes.some(p => url.pathname === p || url.pathname.startsWith(p + '/'))) {
      return next();
    }

    // Payment routes are public — Stripe servers / email recipients hit these without a session
    if (url.pathname === '/api/payment/webhook' || url.pathname === '/api/payment/checkout' || url.pathname === '/api/payment/direct-checkout') {
      return next();
    }

    // Static assets
    const staticAssets = ['/favicon.ico', '/robots.txt'];
    if (staticAssets.includes(url.pathname)) {
      return next();
    }
    if (url.pathname.startsWith('/shared/')) {
      return next();
    }

    // === Auth required from here ===
    const cookies = parseCookies(request.headers.get('Cookie') || '');
    const session = cookies['cp_session'];

    if (!session) {
      return redirectToLogin(url);
    }

    const verified = await verifySession(session, env.SESSION_SECRET);
    if (!verified.valid) {
      return redirectToLogin(url);
    }

    const role = verified.role || 'admin';

    // === Role-based access ===
    // Staff = scanner-only. Allowed:
    //   - /scan (and subpaths)
    //   - /api/checkin
    // Anything else for staff → 403 redirect to /scan
    if (role === 'staff') {
      const staffAllowed =
        url.pathname === '/scan' ||
        url.pathname === '/scan.html' ||
        url.pathname.startsWith('/scan/') ||
        url.pathname === '/api/checkin' ||
        url.pathname === '/api/logout';
      if (!staffAllowed) {
        if (url.pathname.startsWith('/api/')) {
          return new Response(JSON.stringify({ error: 'forbidden', role: 'staff' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        // For page navigation, send staff to their scanner
        return Response.redirect(new URL('/scan', url).toString(), 302);
      }
    }

    return next();
  } catch (err) {
    const msg = (err && err.message) || String(err);
    console.error('[middleware] uncaught on', url.pathname, '-', msg, '\n', err && err.stack);
    if (url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({
        error: 'middleware-crashed',
        path: url.pathname,
        message: msg.substring(0, 500)
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    return Response.redirect(new URL('/login', url).toString(), 302);
  }
}

function parseCookies(cookieHeader) {
  const cookies = {};
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name) cookies[name] = rest.join('=');
  });
  return cookies;
}

function redirectToLogin(url) {
  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return Response.redirect(new URL('/login', url).toString(), 302);
}

async function verifySession(token, secret) {
  if (!secret) return { valid: false };
  try {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return { valid: false };

    const data = JSON.parse(atob(payload));
    if (!data.exp || data.exp < Date.now()) return { valid: false };

    const expectedSig = await hmac(payload, secret);
    if (signature !== expectedSig) return { valid: false };

    return { valid: true, role: data.role || 'admin' };
  } catch {
    return { valid: false };
  }
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
