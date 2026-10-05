import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/safe-next';

const ORIGIN = 'http://localhost:4000';

describe('safeNext', () => {
  it('keeps same-site paths, including query and hash', () => {
    expect(safeNext('/events/abc/queue', ORIGIN)).toBe('/events/abc/queue');
    expect(safeNext('/orders?page=1#top', ORIGIN)).toBe('/orders?page=1#top');
  });

  it.each([
    ['null', null],
    ['empty', ''],
    ['absolute URL', 'https://evil.com'],
    ['protocol-relative', '//evil.com'],
    ['backslash variant', '/\\evil.com'],
    ['tab inside', '/\t/evil.com'],
    ['relative without slash', 'evil.com'],
    ['javascript scheme', 'javascript:alert(1)'],
  ])('falls back to "/" for %s', (_name, value) => {
    expect(safeNext(value, ORIGIN)).toBe('/');
  });
});
