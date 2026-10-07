'use client';

import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import { secondsUntil } from '@/lib/format';

/** Whole seconds left until `iso`, ticking once per second. null while there is no deadline. */
export function useCountdown(iso: string | null | undefined): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!iso) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [iso]);

  if (!iso || now === null) return null;
  return secondsUntil(iso, now);
}

export interface Resource<T> {
  data: T | null;
  error: unknown;
  /** True only for the first load; background refreshes keep showing the previous data. */
  loading: boolean;
  reload: () => void;
}

interface ResourceOptions<T> {
  /** Milliseconds until the next refresh, or null to stop. Called with the latest data. */
  refreshMs?: (data: T) => number | null;
}

/**
 * Loads data and, optionally, keeps it fresh. `key` identifies the request: a new key starts
 * over, `null` keeps the hook idle (e.g. waiting for the session). Aborts on unmount.
 */
export function useResource<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  options: ResourceOptions<T> = {},
): Resource<T> {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: unknown }>({
    key: null,
    data: null,
    error: null,
  });
  const [nonce, setNonce] = useState(0);

  const run = useEffectEvent((signal: AbortSignal) => load(signal));
  const nextRefresh = useEffectEvent((data: T) => options.refreshMs?.(data) ?? null);

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    let timer: number | undefined;

    const fetchOnce = async () => {
      try {
        const data = await run(controller.signal);
        if (controller.signal.aborted) return;
        setState({ key, data, error: null });
        const delay = nextRefresh(data);
        if (delay !== null) timer = window.setTimeout(fetchOnce, delay);
      } catch (error) {
        if (controller.signal.aborted) return;
        setState((previous) => ({
          key,
          data: previous.key === key ? previous.data : null,
          error,
        }));
      }
    };
    void fetchOnce();

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [key, nonce]);

  const reload = useCallback(() => {
    setState((previous) => ({ ...previous, error: null, data: previous.data }));
    setNonce((n) => n + 1);
  }, []);

  const current = state.key === key;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: key !== null && !(current && (state.data !== null || state.error !== null)),
    reload,
  };
}
