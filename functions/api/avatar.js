// deploy-marker 1778406072
// GET /api/avatar?url=<urlencoded Instagram CDN URL>
// Proxies Instagram avatar images server-side to bypass hotlinking protection

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const target = url.searchParams.get('url');

  if (!target) {
    return new Response('Missing url parameter', { status: 400 });
  }

  // Only allow Instagram CDN domains — prevents this proxy being abused
  // for arbitrary images / SSRF
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return new Response('Invalid URL', { status: 400 });
  }

  const allowedHosts = [
    'cdninstagram.com',
    'fbcdn.net',
    'instagram.com'
  ];
  const isAllowed = allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h));
  if (!isAllowed) {
    return new Response('Host not allowed', { status: 403 });
  }

  try {
    const upstream = await fetch(target, {
      // Don't pass through the browser's Referer / Cookies
      // Instagram CDN blocks based on Referer
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/jpeg,image/png,*/*'
      },
      // Caching by Cloudflare itself (24h)
      cf: { cacheTtl: 86400, cacheEverything: true }
    });

    if (!upstream.ok) {
      return new Response(`Upstream ${upstream.status}`, { status: upstream.status });
    }

    const contentType = upstream.headers.get('Content-Type') || 'image/jpeg';
    const body = await upstream.arrayBuffer();

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, immutable',
        'X-Proxy': 'cf-pages-avatar'
      }
    });
  } catch (err) {
    return new Response('Proxy fetch failed: ' + err.message, { status: 502 });
  }
}
