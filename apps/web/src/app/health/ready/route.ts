// GET /health/ready: the web app is useful only if it can reach the Gateway. Cloud Run probes use
// /health/live; this one is for smoke tests (ADR-0004). 503 names the failing check.
export const dynamic = 'force-dynamic';

export async function GET() {
  const base = (
    process.env.SSR_API_BASE_URL ??
    process.env.API_BASE_URL ??
    'http://localhost:8080'
  ).replace(/\/$/, '');
  try {
    const response = await fetch(`${base}/health/live`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    });
    if (response.ok) return Response.json({ status: 'ok', checks: { gateway: 'ok' } });
  } catch {
    // Unreachable or timed out: report below.
  }
  return Response.json({ status: 'error', checks: { gateway: 'error' } }, { status: 503 });
}
