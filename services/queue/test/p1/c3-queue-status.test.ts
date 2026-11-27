// C3 — queue status computation (src/queue/queue-status.ts).
// Pure functions: no doubles besides the injected `random`; time is always a literal `now`.
// One behavior per case; every case name starts with its ID.
import { describe, expect, it, vi } from 'vitest';
import { admittedStatus, passExpiryMs, scoreFor, waitingStatus } from '../../src/queue/queue-status';

const EVENT = '8f1b2c3d-0000-4000-8000-000000000001';
const OPENS_AT = Date.parse('2026-10-01T15:00:00Z');
const WINDOW_SECONDS = 60;
const WINDOW_MS = WINDOW_SECONDS * 1000;

describe('C3 scoreFor', () => {
  it('TC-C3-01 inside the opening window the score is opensAt + random() * window', () => {
    const random = vi.fn(() => 0.5);
    const now = OPENS_AT + 1_000;

    expect(scoreFor(now, OPENS_AT, WINDOW_SECONDS, random)).toBe(OPENS_AT + 30_000);
    expect(random).toHaveBeenCalledTimes(1);
  });

  it('TC-C3-02 at the end of the window (now = opensAt + window) the score is the arrival time', () => {
    const random = vi.fn(() => 0.5);
    const now = OPENS_AT + WINDOW_MS;

    expect(scoreFor(now, OPENS_AT, WINDOW_SECONDS, random)).toBe(now);
    expect(random).not.toHaveBeenCalled();
  });

  it('TC-C3-03 with a 0 s opening window the score is the arrival time, even at opensAt', () => {
    const random = vi.fn(() => 0.5);
    const now = OPENS_AT;

    expect(scoreFor(now, OPENS_AT, 0, random)).toBe(now);
    expect(random).not.toHaveBeenCalled();
  });

  it('TC-C3-11 with a 0 s opening window an arrival before opensAt still scores its arrival time', () => {
    const random = vi.fn(() => 0.5);
    const now = OPENS_AT - 1_000;

    expect(scoreFor(now, OPENS_AT, 0, random)).toBe(now);
    expect(random).not.toHaveBeenCalled();
  });

  it('TC-C3-05 with the largest random value the score stays inside the window (< opensAt + window)', () => {
    const random = vi.fn(() => 0.999999);
    const now = OPENS_AT + 1_000;

    const score = scoreFor(now, OPENS_AT, WINDOW_SECONDS, random);

    expect(score).toBeLessThan(OPENS_AT + WINDOW_MS);
    expect(score).toBeCloseTo(OPENS_AT + 0.999999 * WINDOW_MS, 6);
  });
});

describe('C3 waitingStatus', () => {
  const pacing = { admissionBatchSize: 500, admissionIntervalSeconds: 5 };

  it.each([
    { position: 1, aheadOf: 0, estimatedWaitSeconds: 5 },
    { position: 500, aheadOf: 499, estimatedWaitSeconds: 5 },
    { position: 501, aheadOf: 500, estimatedWaitSeconds: 10 },
  ])(
    'TC-C3-06 batch boundaries (batch 500, 5 s): position $position waits $estimatedWaitSeconds s with $aheadOf ahead',
    ({ position, aheadOf, estimatedWaitSeconds }) => {
      expect(waitingStatus(EVENT, position, pacing)).toEqual({
        eventId: EVENT,
        state: 'WAITING',
        position,
        aheadOf,
        estimatedWaitSeconds,
        passToken: null,
        passExpiresAt: null,
      });
    },
  );
});

describe('C3 admittedStatus', () => {
  it("TC-C3-07 a pass token containing ':' is kept whole and the expiry is ISO without milliseconds", () => {
    expect(admittedStatus(EVENT, '1790000000000:tok:en')).toEqual({
      eventId: EVENT,
      state: 'ADMITTED',
      position: 0,
      aheadOf: 0,
      estimatedWaitSeconds: 0,
      passToken: 'tok:en',
      passExpiresAt: '2026-09-21T14:13:20Z',
    });
  });

  it('TC-C3-08 a stored value without a separator throws RangeError', () => {
    expect(() => admittedStatus(EVENT, 'nocolon')).toThrow(RangeError);
  });
});

describe('C3 passExpiryMs', () => {
  it('TC-C3-09 the expiry is rounded down to the whole second: floor(now / 1000) * 1000 + TTL', () => {
    const now = 1_790_000_000_234;

    expect(passExpiryMs(now, 600)).toBe(1_790_000_600_000);
  });
});
