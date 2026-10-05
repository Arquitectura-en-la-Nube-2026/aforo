import { describe, expect, it } from 'vitest';
import { ApiError, describeError, toSerializable } from '@/lib/errors';
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
