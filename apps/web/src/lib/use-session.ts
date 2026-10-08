'use client';

import { useSyncExternalStore } from 'react';
import { readSession, subscribeSession, type Session } from '@/lib/session';

const noopSubscribe = () => () => {};

/**
 * `ready` is false during server rendering and the first client render, so a protected page can
 * tell "not loaded yet" apart from "signed out" and never redirects too early.
 */
export function useSession(): { session: Session | null; ready: boolean } {
  const session = useSyncExternalStore(subscribeSession, readSession, () => null);
  const ready = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  return { session, ready };
}
