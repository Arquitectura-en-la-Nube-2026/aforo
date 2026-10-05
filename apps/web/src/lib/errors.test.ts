import { describe, expect, it } from 'vitest';
import { parseProblem } from '@/api/client';
import { ApiError, describeError, parseRetryAfter, toSerializable } from '@/lib/errors';
import { es } from '@/lib/i18n/es';

const CID = '6f1c0000-0000-4000-8000-000000000001';

describe('describeError', () => {
  it.each(['SOLD_OUT', 'LIMIT_EXCEEDED', 'RESERVATION_EXPIRED'] as const)(
    '%s has its own text',
    (code) => {
      const view = describeError(new ApiError(409, code, CID));
      expect(view.title).toBe(es.errors[code].title);
      expect(view.correlationId).toBe(CID);
    },
  );

  it.each([
    'ACTIVE_RESERVATION_EXISTS',
    'PAYMENT_UNAVAILABLE',
    'INTERNAL',
    'RATE_LIMITED',
  ] as const)('%s falls back to the generic text and keeps the correlationId visible', (code) => {
    const view = describeError(new ApiError(500, code, CID));
    expect(view.title).toBe(es.errors.generic.title);
    expect(view.correlationId).toBe(CID);
  });

  it('reports a failure to reach the API as a network problem, without a correlationId', () => {
    const view = describeError(ApiError.network());
    expect(view.title).toBe(es.errors.network.title);
    expect(view.correlationId).toBeNull();
  });

  it('treats an unknown thrown value as generic', () => {
    expect(describeError(new Error('boom')).title).toBe(es.errors.generic.title);
  });

  it('never shows the server `detail`', () => {
    const problem = ApiError.fromProblem({
      type: 'https://aforo.dev/errors/sold-out',
      title: 'Not enough availability',
      status: 409,
      code: 'SOLD_OUT',
      detail: 'Sector A has 2 seats left and 4 were requested',
      correlationId: CID,
    });
    const view = describeError(problem);
    expect(JSON.stringify(view)).not.toContain('seats left');
  });
});

describe('toSerializable', () => {
  it('round-trips an ApiError as plain data', () => {
    const plain = toSerializable(new ApiError(409, 'SOLD_OUT', CID));
    expect(plain).toEqual({ status: 409, code: 'SOLD_OUT', correlationId: CID });
    expect(JSON.parse(JSON.stringify(plain))).toEqual(plain);
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');

  it('reads whole seconds', () => {
    expect(parseRetryAfter('45', now)).toBe(45);
    expect(parseRetryAfter('0', now)).toBe(0);
  });

  it('reads an HTTP date as the seconds from now, never negative', () => {
    expect(parseRetryAfter('Mon, 05 Oct 2026 12:00:30 GMT', now)).toBe(30);
    expect(parseRetryAfter('Mon, 05 Oct 2026 11:59:00 GMT', now)).toBe(0);
  });

  it('is null when absent or unreadable', () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('', now)).toBeNull();
    expect(parseRetryAfter('soon', now)).toBeNull();
    expect(parseRetryAfter('-5', now)).toBeNull();
  });
});

describe('parseProblem', () => {
  const problem = (code: string, status: number) =>
    JSON.stringify({ type: 'x', title: 'x', status, code, correlationId: CID });

  it('keeps how long the server asked to wait on a 429, so the screen can wait that long', async () => {
    // The Gateway answers RATE_LIMITED with Retry-After. The error used to drop it, so the screen could not wait.
    const response = new Response(problem('RATE_LIMITED', 429), {
      status: 429,
      headers: { 'content-type': 'application/problem+json', 'retry-after': '45' },
    });
    const error = await parseProblem(response);
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.retryAfterSeconds).toBe(45);
    expect(error.correlationId).toBe(CID);
  });

  it('keeps it when the body is not problem+json (a proxy page)', async () => {
    const response = new Response('<html>busy</html>', {
      status: 429,
      headers: { 'retry-after': '12' },
    });
    const error = await parseProblem(response);
    expect(error.code).toBe('INTERNAL');
    expect(error.retryAfterSeconds).toBe(12);
  });

  it('is null when there is no Retry-After', async () => {
    const response = new Response(problem('SALE_NOT_OPEN', 409), { status: 409 });
    expect((await parseProblem(response)).retryAfterSeconds).toBeNull();
  });
});
