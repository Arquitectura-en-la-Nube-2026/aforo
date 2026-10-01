import { createHmac } from 'node:crypto';
import { verifySignature } from '../src/payments/webhook-signature';

const sign = (body: string, secret: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('webhook signature', () => {
  const body = Buffer.from('{"a":1}');

  it('accepts a valid HMAC over the raw body', () => {
    expect(verifySignature(body, sign('{"a":1}', 's3cret'), 's3cret')).toBe(true);
  });

  it('rejects a body that was re-serialized or altered', () => {
    expect(verifySignature(Buffer.from('{"a": 1}'), sign('{"a":1}', 's3cret'), 's3cret')).toBe(false);
  });

  it('rejects a wrong secret, a missing header and a malformed header', () => {
    expect(verifySignature(body, sign('{"a":1}', 'other'), 's3cret')).toBe(false);
    expect(verifySignature(body, undefined, 's3cret')).toBe(false);
    expect(verifySignature(body, 'sha256=zz', 's3cret')).toBe(false);
    expect(verifySignature(undefined, sign('{"a":1}', 's3cret'), 's3cret')).toBe(false);
  });
});
