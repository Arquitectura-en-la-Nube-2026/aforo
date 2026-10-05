'use client';

import { useCallback, useEffect, useState } from 'react';
import { getQueueStatus, joinQueue, openQueueStream } from '@/api/endpoints';
import { ApiError } from '@/lib/errors';
import { clearPass, savePass } from '@/lib/pass';
import { readSession } from '@/lib/session';
import { readSse } from '@/lib/sse';
import type { QueueStatus } from '@/lib/types';

export type QueuePhase =
  | 'joining' // asking to enter the queue
  | 'waiting' // in line
  | 'admitted' // it is our turn; the pass is saved
  | 'expired' // the pass ran out; no auto-renew, the buyer re-joins
  | 'lost' // the queue no longer knows us (it was restarted); joining again costs nothing
  | 'not-open' // 409 SALE_NOT_OPEN
  | 'error';

/** How the position reaches the screen: SSE when possible, polling every 3 s as plan B (D-13). */
export type Transport = 'connecting' | 'stream' | 'polling';

export const POLL_MS = 3000;
/** While polling, the stream is tried again this often: the server may have cut it (Cloud Run's request timeout, a deploy). */
export const STREAM_RETRY_MS = 30_000;
/** Polls that fail in a row before the screen says the connection is down. */
export const OFFLINE_AFTER_FAILURES = 3;
/** A Retry-After longer than this is not worth honouring: the buyer would think the page froze. */
const MAX_WAIT_MS = 60_000;

/** The server said ADMITTED without a pass: a broken answer, not a position. Waiting on it would never end. */
class BrokenAnswer extends Error {}
/** The queue answered 404 to something that was working: our place is gone. */
class PlaceLost extends Error {}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const id = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(id);
      resolve();
    });
  });

/** A stream message must look like a QueueStatus; anything else is treated as a broken stream. */
function parseStatus(data: string): QueueStatus {
  const value = JSON.parse(data) as Partial<QueueStatus> | null;
  const valid =
    value !== null &&
    typeof value === 'object' &&
    (value.state === 'WAITING' || value.state === 'ADMITTED') &&
    typeof value.position === 'number' &&
    typeof value.aheadOf === 'number' &&
    typeof value.estimatedWaitSeconds === 'number';
  if (!valid) throw new Error('malformed queue message');
  return value as QueueStatus;
}

const isNotFound = (failure: unknown) =>
  failure instanceof ApiError && failure.code === 'NOT_FOUND';

/** How long a 429 asks us to wait: its Retry-After, never less than a poll, never more than MAX_WAIT_MS. */
const rateLimitWaitMs = (failure: unknown): number | null =>
  failure instanceof ApiError && failure.code === 'RATE_LIMITED'
    ? Math.min(Math.max((failure.retryAfterSeconds ?? 0) * 1000, POLL_MS), MAX_WAIT_MS)
    : null;

export interface QueueState {
  phase: QueuePhase;
  status: QueueStatus | null;
  /** The first position we saw, to draw how far along the line we are. */
  startPosition: number | null;
  transport: Transport;
  /** True after several failed polls in a row: the page cannot reach the server (the place is kept). */
  offline: boolean;
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
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let failures = 0;
    // The buyer who queued. Another tab may sign in as someone else before the admission arrives.
    const owner = readSession()?.user.id;
    let admittedOnce = false;

    const reachable = () => {
      failures = 0;
      setOffline(false);
    };

    /** Applies one status. Returns true when the buyer has been admitted. */
    const apply = (next: QueueStatus): boolean => {
      // Admission is final: a status sent before it (the one asked when the tab came back) may arrive
      // after it, and must not take the screen back to "waiting" with nothing left running.
      if (admittedOnce) return true;
      setStatus(next);
      if (next.state === 'ADMITTED') {
        if (!next.passToken || !next.passExpiresAt) throw new BrokenAnswer();
        savePass(eventId, { passToken: next.passToken, passExpiresAt: next.passExpiresAt }, owner);
        admittedOnce = true;
        setPhase('admitted');
        return true;
      }
      setStartPosition((first) => first ?? next.position);
      setPhase('waiting');
      return false;
    };

    /**
     * One try at the stream. True when the buyer was admitted. Throws when it cannot be opened or breaks.
     * Whatever happens, its connection is closed: a stream left open after the screen moved on to
     * polling would pile up with every retry.
     */
    const viaStream = async (): Promise<boolean> => {
      const streamAttempt = new AbortController();
      const stop = () => streamAttempt.abort();
      signal.addEventListener('abort', stop, { once: true });
      let admitted = false;
      try {
        const response = await openQueueStream(eventId, streamAttempt.signal);
        setTransport('stream');
        reachable();
        await readSse(response, (message) => {
          if (message.event !== 'position' && message.event !== 'admitted') return;
          if (apply(parseStatus(message.data))) {
            admitted = true;
            streamAttempt.abort(); // the client closes the stream after `admitted` (queue.yaml)
          }
        });
      } catch (failure) {
        // After we abort it ourselves the read throws an AbortError, which is not a failure.
        if (!admitted || failure instanceof BrokenAnswer) throw failure;
      } finally {
        signal.removeEventListener('abort', stop);
        streamAttempt.abort();
      }
      return admitted;
    };

    /** Polls `status` every 3 s until admitted. False after STREAM_RETRY_MS, so the caller tries the stream again. */
    const poll = async (): Promise<boolean> => {
      setTransport('polling');
      const until = Date.now() + STREAM_RETRY_MS;
      while (!signal.aborted && Date.now() < until) {
        let waitMs = POLL_MS;
        try {
          const next = await getQueueStatus(eventId, { signal });
          reachable();
          if (apply(next)) return true;
        } catch (failure) {
          if (signal.aborted) return false;
          if (failure instanceof BrokenAnswer) throw failure;
          if (isNotFound(failure)) throw new PlaceLost();
          const rateLimited = rateLimitWaitMs(failure);
          if (rateLimited !== null) {
            // The server is up and asked us to slow down: wait as long as it said, it is not an outage.
            waitMs = rateLimited;
          } else {
            // A 401 is handled globally. Anything else counts toward "offline" and is retried.
            failures += 1;
            if (failures >= OFFLINE_AFTER_FAILURES) setOffline(true);
          }
        }
        await sleep(waitMs, signal);
      }
      return false;
    };

    const run = async () => {
      setPhase('joining');
      setStatus(null);
      setStartPosition(null);
      setError(null);
      setOffline(false);
      setTransport('connecting');
      try {
        if (apply(await joinQueue(eventId, { signal }))) return;
        while (!signal.aborted) {
          try {
            if (await viaStream()) return;
          } catch (failure) {
            if (signal.aborted) return;
            if (failure instanceof BrokenAnswer) throw failure;
            if (isNotFound(failure)) throw new PlaceLost();
            // A 429 here shares the quota with `status`: polling at once would only get another 429.
            const rateLimited = rateLimitWaitMs(failure);
            if (rateLimited !== null) await sleep(rateLimited, signal);
            // Stream refused or cut: plan B for a while, then try the stream again.
          }
          if (signal.aborted || (await poll())) return;
        }
      } catch (failure) {
        if (signal.aborted) return;
        if (failure instanceof PlaceLost) setPhase('lost');
        else if (failure instanceof BrokenAnswer) {
          setError(new ApiError(0, 'INTERNAL', null));
          setPhase('error');
        } else if (failure instanceof ApiError && failure.code === 'SALE_NOT_OPEN')
          setPhase('not-open');
        else {
          setError(failure);
          setPhase('error');
        }
      }
    };

    // A hidden tab throttles its timers and may have its stream suspended: ask once when it comes back.
    const onVisible = () => {
      if (signal.aborted || document.visibilityState !== 'visible') return;
      getQueueStatus(eventId, { signal })
        .then((next) => {
          if (!signal.aborted && apply(next)) controller.abort(); // admitted: stop the stream and the polling
        })
        .catch(() => undefined); // best effort: the stream or the polling carries on
    };
    document.addEventListener('visibilitychange', onVisible);

    void run();
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      controller.abort();
    };
  }, [eventId, attempt]);

  const restart = useCallback(() => setAttempt((n) => n + 1), []);

  const expirePass = useCallback(() => {
    clearPass(eventId);
    setPhase('expired');
  }, [eventId]);

  return { phase, status, startPosition, transport, offline, error, restart, expirePass };
}
