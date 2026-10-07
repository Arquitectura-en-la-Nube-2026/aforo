// Session = whatever the Gateway returned at login (apps/web/README.md, rule 1). When Identity
// Platform arrives, only the login screen changes. Kept in localStorage so a new tab is still
// signed in; the token lives 8 hours.
import type { LoginResponse } from '@/lib/types';

const KEY = 'aforo.session';

export interface Session {
  accessToken: string;
  expiresAt: string;
  user: LoginResponse['user'];
}

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedSession: Session | null = null;

export function readSession(): Session | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === cachedRaw) return cachedSession;
  cachedRaw = raw;
  cachedSession = null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Session;
      if (parsed.accessToken && new Date(parsed.expiresAt).getTime() > Date.now()) {
        cachedSession = parsed;
      }
    } catch {
      cachedSession = null;
    }
  }
  return cachedSession;
}

function emit() {
  listeners.forEach((listener) => listener());
}

export function saveSession(login: LoginResponse) {
  const session: Session = {
    accessToken: login.accessToken,
    expiresAt: login.expiresAt,
    user: login.user,
  };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Storage blocked: the session lasts only until reload.
    cachedRaw = JSON.stringify(session);
    cachedSession = session;
  }
  emit();
}

export function clearSession() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
  cachedRaw = null;
  cachedSession = null;
  emit();
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return readSession()?.accessToken ?? null;
}

export function subscribeSession(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}
