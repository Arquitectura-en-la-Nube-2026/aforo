// C3 — queue status computation (src/queue/queue-status.ts).
// Template: copy a case, give it the next TC-C3-nn ID, test one behavior per case.
// Time and randomness are always injected: `now` is a literal, `random` is a stub.
import { describe, expect, it, vi } from 'vitest';
import { scoreFor } from '../../src/queue/queue-status';

const OPENS_AT = Date.parse('2026-10-01T15:00:00Z');
const WINDOW_SECONDS = 60;

describe('C3 scoreFor', () => {
  it('TC-C3-01 inside the opening window the score is opensAt + random() * window', () => {
    const random = vi.fn(() => 0.5);
    const now = OPENS_AT + 10_000;

    expect(scoreFor(now, OPENS_AT, WINDOW_SECONDS, random)).toBe(OPENS_AT + 30_000);
    expect(random).toHaveBeenCalledTimes(1);
  });

  it('TC-C3-02 at the end of the window (now = opensAt + window) the score is the arrival time', () => {
    const random = vi.fn(() => 0.5);
    const now = OPENS_AT + WINDOW_SECONDS * 1000;

    expect(scoreFor(now, OPENS_AT, WINDOW_SECONDS, random)).toBe(now);
    expect(random).not.toHaveBeenCalled();
  });
});
