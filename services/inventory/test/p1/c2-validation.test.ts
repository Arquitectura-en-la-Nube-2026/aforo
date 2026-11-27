// C2 — reservation request validation (src/reservations/validation.ts).
// Template: copy a case, give it the next TC-C2-nn ID, test one behavior per case.
// Pure functions: no doubles needed; DomainError comes from @aforo/common (the real one).
import { DomainError } from '@aforo/common';
import { describe, expect, it } from 'vitest';
import { parseCreateReservation, uuidParam } from '../../src/reservations/validation';

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

  it.each([
    ['1.5 (fractional number)', 1.5],
    ['"2" (numeric string)', '2'],
  ])('TC-C2-03 quantity %s is rejected with VALIDATION_ERROR and a field error on quantity', (_label, quantity) => {
    const err = catchDomainError(() => parseCreateReservation(validBody({ quantity })));
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.fieldErrors).toEqual([{ field: 'quantity', message: 'quantity must be an integer >= 1' }]);
  });

  it('TC-C2-05 a malformed eventId is rejected with a field error on eventId only', () => {
    const err = catchDomainError(() => parseCreateReservation(validBody({ eventId: 'abc' })));
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.fieldErrors).toEqual([{ field: 'eventId', message: 'eventId must be a UUID' }]);
  });

  it('TC-C2-05 a missing sectorId is rejected with a field error on sectorId only', () => {
    const { sectorId: _omitted, ...body } = validBody();
    const err = catchDomainError(() => parseCreateReservation(body));
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.fieldErrors).toEqual([{ field: 'sectorId', message: 'sectorId must be a UUID' }]);
  });

  it('TC-C2-06 an unknown field is rejected with a field error naming that field', () => {
    const err = catchDomainError(() => parseCreateReservation(validBody({ extra: 'x' })));
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.fieldErrors).toEqual([{ field: 'extra', message: 'unknown field' }]);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'text'],
    ['a number', 42],
  ])('TC-C2-07 a body that is %s is rejected with a single field error on body', (_label, body) => {
    const err = catchDomainError(() => parseCreateReservation(body));
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.fieldErrors).toEqual([{ field: 'body', message: 'body must be an object' }]);
  });

  it('TC-C2-10 a well-formed non-v4 UUID is accepted (contract: format uuid)', () => {
    const v1 = 'c232ab00-9414-11ec-b3c8-9f6bdeced846';
    expect(parseCreateReservation(validBody({ eventId: v1 }))).toEqual({
      eventId: v1,
      sectorId: SECTOR,
      quantity: 1,
      buyerId: BUYER,
    });
  });

  it('TC-C2-12 several invalid fields are reported together in one VALIDATION_ERROR', () => {
    const err = catchDomainError(() =>
      parseCreateReservation(validBody({ eventId: 'abc', quantity: 0, extra: 'x' })),
    );
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.fieldErrors).toEqual([
      { field: 'eventId', message: 'eventId must be a UUID' },
      { field: 'quantity', message: 'quantity must be an integer >= 1' },
      { field: 'extra', message: 'unknown field' },
    ]);
  });
});

describe('C2 uuidParam', () => {
  it('TC-C2-11 a malformed path parameter is rejected with VALIDATION_ERROR and a field error naming it', () => {
    const err = catchDomainError(() => uuidParam('reservationId', 'not-a-uuid'));
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.fieldErrors).toEqual([{ field: 'reservationId', message: 'reservationId must be a UUID' }]);
  });

  it('TC-C2-13 a valid path parameter is returned unchanged', () => {
    const id = '44444444-4444-4444-8444-444444444444';
    expect(uuidParam('reservationId', id)).toBe(id);
  });
});
