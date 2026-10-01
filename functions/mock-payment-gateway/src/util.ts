import { createHash, createHmac } from 'node:crypto';

/** Deterministic UUID v4-shaped id derived from a seed (idempotency without a lookup table). */
export function deterministicUuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest();
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** `X-Signature` value: sha256=<hex HMAC-SHA256 of the raw body>. */
export const sign = (rawBody: string | Buffer, secret: string): string =>
  `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
