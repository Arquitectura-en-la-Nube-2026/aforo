// C2 — reservation request validation (src/reservations/validation.ts).
// Template: copy a case, give it the next TC-C2-nn ID, test one behavior per case.
// Pure functions: no doubles needed; DomainError comes from @aforo/common (the real one).
import { DomainError } from '@aforo/common';
import { describe, expect, it } from 'vitest';
import { parseCreateReservation } from '../../src/reservations/validation';

const EVENT = '11111111-1111-4111-8111-111111111111';
const SECTOR = '22222222-2222-4222-8222-222222222222';
const BUYER = '33333333-3333-4333-8333-333333333333';

const validBody = (overrides: Record<string, unknown> = {}) => ({
  eventId: EVENT,
  sectorId: SECTOR,
  buyerId: BUYER,
  quantity: 1,
  ...overrides,
});

/** Runs `fn`, expects a DomainError and returns it so the case can assert on code and fields. */
function catchDomainError(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    return err as DomainError;
  }
  throw new Error('expected a DomainError, nothing was thrown');
}

describe('C2 parseCreateReservation', () => {
  it('TC-C2-01 quantity 1 (lower bound) is accepted and the request is returned as is', () => {
    expect(parseCreateReservation(validBody({ quantity: 1 }))).toEqual({
      eventId: EVENT,
      sectorId: SECTOR,
      quantity: 1,
      buyerId: BUYER,
    });
  });

  it('TC-C2-02 quantity 0 is rejected with VALIDATION_ERROR and a field error on quantity', () => {
    const err = catchDomainError(() => parseCreateReservation(validBody({ quantity: 0 })));
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.fieldErrors).toEqual([{ field: 'quantity', message: 'quantity must be an integer >= 1' }]);
  });
});
