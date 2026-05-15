// deploy-marker safe-handler-v1
// Wraps any Pages Function handler so that uncaught exceptions
// are converted into a JSON 500 response instead of a bare 500
// from the Cloudflare runtime.
//
// Usage:
//   import { safe } from '../_lib/safe-handler.js';
//   export const onRequestGet  = safe('GET /api/foo',  async (ctx) => { ... });
//   export const onRequestPost = safe('POST /api/foo', async (ctx) => { ... });

export function safe(label, handler) {
  return async (context) => {
    try {
      const result = await handler(context);
      // Defensive: if a handler returns undefined/null, still produce a JSON response
      if (!result) {
        console.error(`[${label}] handler returned no Response`);
        return new Response(
          JSON.stringify({ error: 'handler-returned-no-response', where: label }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return result;
    } catch (err) {
      const msg = (err && err.message) || String(err);
      const stack = (err && err.stack) || '';
      console.error(`[${label}] uncaught:`, msg, '\n', stack);
      return new Response(
        JSON.stringify({
          error: 'internal',
          where: label,
          message: msg.substring(0, 500),
          stack: stack.substring(0, 1500)
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  };
}
