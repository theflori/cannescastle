// deploy-marker stripe-webhook-stub
// Stub: returns 200 OK without doing anything. Used to test whether the
// /api/stripe/ route directory itself causes a routing issue.
export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true, stub: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
