import { describe, expect, it } from 'vitest';
import { formatCents, formatClock, secondsUntil } from '@/lib/format';

// Intl output uses no-break spaces; compare with all whitespace normalised.
const flat = (text: string) => text.replace(/\s/g, ' ');

describe('formatCents', () => {
  it('shows integer cents as whole pesos (18000000 cents = $ 180.000)', () => {
    expect(flat(formatCents(18_000_000))).toBe('$ 180.000');
  });

  it('formats a total of two tickets', () => {
    expect(flat(formatCents(36_000_000))).toBe('$ 360.000');
  });

  it('formats zero', () => {
    expect(flat(formatCents(0))).toBe('$ 0');
  });
});

describe('formatClock', () => {
  it('pads minutes and seconds', () => {
    expect(formatClock(187)).toBe('03:07');
    expect(formatClock(600)).toBe('10:00');
  });

  it('never goes negative', () => {
    expect(formatClock(-5)).toBe('00:00');
  });
});

describe('secondsUntil', () => {
  const now = Date.parse('2026-10-01T15:00:00Z');

  it('rounds up to whole seconds', () => {
    expect(secondsUntil('2026-10-01T15:00:00.400Z', now)).toBe(1);
  });

  it('is 0 once the deadline has passed', () => {
    expect(secondsUntil('2026-10-01T14:59:00Z', now)).toBe(0);
  });
});
