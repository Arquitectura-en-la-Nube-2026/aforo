// GET /health/live: the process answers. Never requires authentication (contracts/conventions.md).
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok' });
}
