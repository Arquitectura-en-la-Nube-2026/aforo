// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPass, getPass, savePass } from '@/lib/pass';
import { clearSession, saveSession } from '@/lib/session';

const EVENT = '8f1b2c3d-0000-4000-8000-000000000001';
const OTHER_EVENT = '8f1b2c3d-0000-4000-8000-000000000002';
const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

function signInAs(id: string) {
  saveSession({
    accessToken: `token-${id}`,
    tokenType: 'Bearer',
    expiresAt: inMinutes(480),
    user: { id, email: `${id}@example.com`, displayName: id },
  });
}

describe('queue pass', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    clearSession();
    signInAs('ana');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearPass(EVENT);
    clearPass(OTHER_EVENT);
  });

  it('keeps the pass of an event and returns it until it expires', () => {
    savePass(EVENT, { passToken: 'p_ana', passExpiresAt: inMinutes(10) });
    expect(getPass(EVENT)?.passToken).toBe('p_ana');
    expect(getPass(OTHER_EVENT)).toBeNull();
  });

  it("does not hand one buyer's pass to the next buyer who signs in on the same tab", () => {
    // sessionStorage lives as long as the tab, and signing out only clears the session. Without the
    // user in the key, Ben opened /buy with Ana's pass and the buy screen treated it as his own.
    savePass(EVENT, { passToken: 'p_ana', passExpiresAt: inMinutes(10) });

    clearSession();
    signInAs('ben');
    expect(getPass(EVENT)).toBeNull();

    savePass(EVENT, { passToken: 'p_ben', passExpiresAt: inMinutes(10) });
    expect(getPass(EVENT)?.passToken).toBe('p_ben');

    clearSession();
    signInAs('ana');
    expect(getPass(EVENT)?.passToken).toBe('p_ana');
  });

  it('forgets a pass that has expired, and clears it from storage', () => {
    savePass(EVENT, {
      passToken: 'p_old',
      passExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(getPass(EVENT)).toBeNull();
    expect(
      Object.keys(window.sessionStorage).filter((key) => key.startsWith('aforo.pass.')),
    ).toEqual([]);
  });

  it('clearPass removes only the signed-in buyer pass', () => {
    savePass(EVENT, { passToken: 'p_ana', passExpiresAt: inMinutes(10) });
    clearSession();
    signInAs('ben');
    savePass(EVENT, { passToken: 'p_ben', passExpiresAt: inMinutes(10) });

    clearPass(EVENT);
    expect(getPass(EVENT)).toBeNull();
    clearSession();
    signInAs('ana');
    expect(getPass(EVENT)?.passToken).toBe('p_ana');
  });

  it('survives a reload: it is read back from sessionStorage', async () => {
    savePass(EVENT, { passToken: 'p_ana', passExpiresAt: inMinutes(10) });
    vi.resetModules(); // a reload empties the in-memory copy
    const reloaded = await import('@/lib/pass');
    expect(reloaded.getPass(EVENT)?.passToken).toBe('p_ana');
  });

  it('still works in memory when sessionStorage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() =>
      savePass(EVENT, { passToken: 'p_ana', passExpiresAt: inMinutes(10) }),
    ).not.toThrow();
    expect(getPass(EVENT)?.passToken).toBe('p_ana');
  });
});
