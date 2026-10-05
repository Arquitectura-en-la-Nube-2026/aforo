'use client';

import { useCallback, useEffect, useState } from 'react';
import { getQueueStatus, joinQueue, openQueueStream } from '@/api/endpoints';
import { ApiError } from '@/lib/errors';
import { clearPass, savePass } from '@/lib/pass';
import { readSse } from '@/lib/sse';
import type { QueueStatus } from '@/lib/types';

export type QueuePhase =
  | 'joining' // asking to enter the queue
  | 'waiting' // in line
  | 'admitted' // it is our turn; the pass is saved
  | 'expired' // the pass ran out; no auto-renew, the buyer re-joins
  | 'not-open' // 409 SALE_NOT_OPEN
  | 'error';

/** How the position reaches the screen: SSE when possible, polling every 3 s as plan B (D-13). */
export type Transport = 'connecting' | 'stream' | 'polling';

const POLL_MS = 3000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const id = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(id);
      resolve();
    });
  });

export interface QueueState {
  phase: QueuePhase;
  status: QueueStatus | null;
  /** The first position we saw, to draw how far along the line we are. */
  startPosition: number | null;
  transport: Transport;
  error: unknown;
  /** Join again from scratch (after an error or when the pass expired). */
  restart: () => void;
  /** Called by the screen when the pass countdown reaches zero. */
  expirePass: () => void;
}

export function useQueue(eventId: string): QueueState {
  const [phase, setPhase] = useState<QueuePhase>('joining');
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [startPosition, setStartPosition] = useState<number | null>(null);
  const [transport, setTransport] = useState<Transport>('connecting');
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    /** Applies one status. Returns true when the buyer has been admitted. */
    const apply = (next: QueueStatus): boolean => {
      setStatus(next);
      if (next.state === 'ADMITTED' && next.passToken && next.passExpiresAt) {
        savePass(eventId, { passToken: next.passToken, passExpiresAt: next.passExpiresAt });
        setPhase('admitted');
        return true;
      }
      setStartPosition((first) => first ?? next.position);
      setPhase('waiting');
      return false;
    };

    const viaStream = async (): Promise<boolean> => {
      const response = await openQueueStream(eventId, signal);
      setTransport('stream');
      let admitted = false;
      await readSse(response, (message) => {
        if (message.event !== 'position' && message.event !== 'admitted') return;
        if (apply(JSON.parse(message.data) as QueueStatus)) admitted = true;
      });
      return admitted;
    };

    const viaPolling = async () => {
      setTransport('polling');
      while (!signal.aborted) {
        try {
          if (apply(await getQueueStatus(eventId, { signal }))) return;
        } catch (failure) {
          if (signal.aborted) return;
          // A 401 is handled globally. Anything else is retried on the next tick.
          if (failure instanceof ApiError && failure.code === 'NOT_FOUND') throw failure;
        }
        await sleep(POLL_MS, signal);
      }
    };

    const run = async () => {
      setPhase('joining');
      setStatus(null);
      setStartPosition(null);
      setError(null);
      setTransport('connecting');
      try {
        if (apply(await joinQueue(eventId, { signal }))) return;
        try {
          if (await viaStream()) return;
        } catch {
          // Stream refused or cut: fall back to polling the status endpoint.
        }
        if (!signal.aborted) await viaPolling();
      } catch (failure) {
        if (signal.aborted) return;
        if (failure instanceof ApiError && failure.code === 'SALE_NOT_OPEN') setPhase('not-open');
        else {
          setError(failure);
          setPhase('error');
        }
      }
    };

    void run();
    return () => controller.abort();
  }, [eventId, attempt]);

  const restart = useCallback(() => setAttempt((n) => n + 1), []);

  const expirePass = useCallback(() => {
    clearPass(eventId);
    setPhase('expired');
  }, [eventId]);

  return { phase, status, startPosition, transport, error, restart, expirePass };
}
