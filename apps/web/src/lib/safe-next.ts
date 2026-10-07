/**
 * The `next` query param says where to go after login. Only same-site paths are allowed: anything
 * else (`//evil.com`, `https://evil.com`, `/\evil.com`, which browsers read as `//evil.com`) would
 * be an open redirect. The value is resolved against our own origin and must stay on it.
 */
export function safeNext(value: string | null, origin: string): string {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    /[\x00-\x1f]/.test(value)
  ) {
    return '/';
  }
  try {
    const url = new URL(value, origin);
    return url.origin === origin ? url.pathname + url.search + url.hash : '/';
  } catch {
    return '/';
  }
}
