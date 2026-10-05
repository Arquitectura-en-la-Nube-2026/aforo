// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getQueueStatus, joinQueue, openQueueStream } from '@/api/endpoints';
import {
  OFFLINE_AFTER_FAILURES,
  POLL_MS,
  STREAM_RETRY_MS,
  useQueue,
} from '@/features/queue/use-queue';
import { ApiError } from '@/lib/errors';
import { clearPass, getPass } from '@/lib/pass';
import { clearSession, saveSession } from '@/lib/session';
import type { QueueStatus } from '@/lib/types';

vi.mock('@/api/endpoints', () => ({
  joinQueue: vi.fn(),
  getQueueStatus: vi.fn(),
  openQueueStream: vi.fn(),
}));

const EVENT = '8f1b2c3d-0000-4000-8000-000000000001';

const waiting = (position: number): QueueStatus => ({
  eventId: EVENT,
  state: 'WAITING',
  position,
  aheadOf: position - 1,
  estimatedWaitSeconds: 5,
  passToken: null,
  passExpiresAt: null,
});
const admitted = (token = 'p_abc'): QueueStatus => ({
  eventId: EVENT,
  state: 'ADMITTED',
  position: 0,
  aheadOf: 0,
  estimatedWaitSeconds: 0,
  passToken: token,
  passExpiresAt: new Date(Date.now() + 600_000).toISOString(),
});
const message = (name: 'position' | 'admitted', status: QueueStatus) =>
  `event: ${name}\ndata: ${JSON.stringify(status)}\n\n`;

/**
 * An SSE response the test controls. Aborting its signal errors the body, like a real aborted fetch:
 * the connection is closed by the abort itself, so tests check `signal.aborted`, not `cancel`.
 */
function fakeStream(signal: AbortSignal) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel,
  });
  signal.addEventListener('abort', () => {
    try {
      controller.error(new DOMException('aborted', 'AbortError'));
    } catch {
      // already closed
    }
  });
  return {
    response: new Response(body),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
    cancel,
    /** The fetch behind this stream: aborting it is what closes the connection. */
    signal,
  };
}

type Stream = ReturnType<typeof fakeStream>;
/** Makes each call to openQueueStream return a new controllable stream, and collects them. */
function streamsOpened(): Stream[] {
  const streams: Stream[] = [];
  vi.mocked(openQueueStream).mockImplementation(async (_eventId, signal) => {
    const stream = fakeStream(signal);
    streams.push(stream);
    return stream.response;
  });
  return streams;
}

const apiError = (code: ApiError['code'], status: number, retryAfter: number | null = null) =>
  new ApiError(status, code, 'cid-1', retryAfter);

/** Lets promises and timers run for `ms` of fake time, inside act so React applies the state. */
const advance = (ms = 0) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

function mount() {
  return renderHook(() => useQueue(EVENT));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(joinQueue).mockReset();
  vi.mocked(getQueueStatus).mockReset();
  vi.mocked(openQueueStream).mockReset();
  window.sessionStorage.clear();
  window.localStorage.clear();
  clearSession();
  saveSession({
    accessToken: 't',
    tokenType: 'Bearer',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: 'ana', email: 'ana@example.com', displayName: 'Ana' },
  });
});
afterEach(() => {
  clearPass(EVENT);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useQueue: getting in', () => {
  it('goes straight to admitted, and keeps the pass, when join already says ADMITTED', async () => {
    vi.mocked(joinQueue).mockResolvedValue(admitted('p_now'));
    const { result } = mount();
    await advance();
    expect(result.current.phase).toBe('admitted');
    expect(getPass(EVENT)?.passToken).toBe('p_now');
    expect(openQueueStream).not.toHaveBeenCalled();
  });

  it('shows not-open on 409 SALE_NOT_OPEN, and an error panel on anything else', async () => {
    vi.mocked(joinQueue).mockRejectedValueOnce(apiError('SALE_NOT_OPEN', 409));
    const first = mount();
    await advance();
    expect(first.result.current.phase).toBe('not-open');

    vi.mocked(joinQueue).mockRejectedValueOnce(apiError('INTERNAL', 500));
    const second = mount();
    await advance();
    expect(second.result.current.phase).toBe('error');
    expect((second.result.current.error as ApiError).correlationId).toBe('cid-1');
  });

  it('treats a 404 on join as an error (unknown event), not as a lost place', async () => {
    vi.mocked(joinQueue).mockRejectedValue(apiError('NOT_FOUND', 404));
    const { result } = mount();
    await advance();
    expect(result.current.phase).toBe('error');
  });

  it('shows an error, and does not wait forever, when ADMITTED comes without a pass', async () => {
    // An ADMITTED with no passToken used to be treated as "waiting": a buyer at position 0 stared at a
    // number that would never change.
    vi.mocked(joinQueue).mockResolvedValue({ ...admitted(), passToken: null });
    const { result } = mount();
    await advance();
    expect(result.current.phase).toBe('error');
    expect(getPass(EVENT)).toBeNull();
  });
});

describe('useQueue: following the position', () => {
  it('follows the stream and, on admitted, saves the pass and closes the stream', async () => {
    vi.mocked(joinQueue).mockResolvedValue(waiting(3));
    const streams = streamsOpened();
    const { result } = mount();
    await advance();
    expect(result.current.transport).toBe('stream');
    expect(result.current.status?.position).toBe(3);

    await act(async () => streams[0].push(message('position', waiting(2))));
    await advance();
    expect(result.current.status?.position).toBe(2);
    expect(result.current.phase).toBe('waiting');

    await act(async () => streams[0].push(message('admitted', admitted('p_stream'))));
    await advance();
    expect(result.current.phase).toBe('admitted');
    expect(getPass(EVENT)?.passToken).toBe('p_stream');
    expect(streams[0].signal.aborted).toBe(true); // the client closes the stream after admitted
    expect(getQueueStatus).not.toHaveBeenCalled();
    await advance(POLL_MS * 3);
    expect(getQueueStatus).not.toHaveBeenCalled(); // and does not start polling
  });

  it('is not fooled by an admitted event whose line break arrives split between two chunks', async () => {
    vi.mocked(joinQueue).mockResolvedValue(waiting(1));
    const streams = streamsOpened();
    const { result } = mount();
    await advance();

    const body = JSON.stringify(admitted('p_split'));
    await act(async () => streams[0].push('event: admitted\r'));
    await act(async () => streams[0].push(`\ndata: ${body}\r\n\r\n`));
    await advance();
    expect(result.current.phase).toBe('admitted');
  });

  it('falls back to polling when the stream cannot be opened, and keeps following the position', async () => {
    vi.mocked(joinQueue).mockResolvedValue(waiting(5));
    vi.mocked(openQueueStream).mockRejectedValue(apiError('INTERNAL', 503));
    vi.mocked(getQueueStatus).mockResolvedValueOnce(waiting(4)).mockResolvedValueOnce(waiting(3));
    const { result } = mount();
    await advance();
    expect(result.current.transport).toBe('polling');
    expect(result.current.status?.position).toBe(4);

    await advance(POLL_MS);
    expect(result.current.status?.position).toBe(3);
  });

  it('is admitted through polling too', async () => {
    vi.mocked(joinQueue).mockResolvedValue(waiting(2));
    vi.mocked(openQueueStream).mockRejectedValue(apiError('INTERNAL', 503));
    vi.mocked(getQueueStatus)
      .mockResolvedValueOnce(waiting(1))
      .mockResolvedValue(admitted('p_poll'));
    const { result } = mount();
    await advance(POLL_MS);
    expect(result.current.phase).toBe('admitted');
    expect(getPass(EVENT)?.passToken).toBe('p_poll');
    const calls = vi.mocked(getQueueStatus).mock.calls.length;
    await advance(POLL_MS * 3);
    expect(vi.mocked(getQueueStatus).mock.calls.length).toBe(calls); // polling stopped
  });

  it('polls right away when the server ends the stream without admitting', async () => {
    vi.mocked(joinQueue).mockResolvedValue(waiting(4));
    const streams = streamsOpened();
    vi.mocked(getQueueStatus).mockResolvedValue(waiting(3));
    const { result } = mount();
    await advance();
    await act(async () => streams[0].end());
    await advance();
    expect(result.current.transport).toBe('polling');
    expect(getQueueStatus).toHaveBeenCalled();
  });

  it('tries the stream again after a while of polling, without leaving the old one open', async () => {
    // Cloud Run can cut a stream (its request timeout, a deploy). The buyer should get "live" back.
    vi.mocked(joinQueue).mockResolvedValue(waiting(9));
    const streams: Stream[] = [];
    vi.mocked(openQueueStream)
      .mockRejectedValueOnce(apiError('INTERNAL', 503))
      .mockImplementation(async (_eventId, signal) => {
        const stream = fakeStream(signal);
        streams.push(stream);
        return stream.response;
      });
    vi.mocked(getQueueStatus).mockResolvedValue(waiting(8));
    const { result } = mount();
    await advance();
    expect(result.current.transport).toBe('polling');

    await advance(STREAM_RETRY_MS + POLL_MS);
    expect(openQueueStream).toHaveBeenCalledTimes(2);
    expect(result.current.transport).toBe('stream');
    expect(streams).toHaveLength(1);
  });

  it('drops a stream that sends a malformed message, closes it, and polls instead', async () => {
    // JSON.parse of `data: {` used to throw inside the read loop and leave the connection open.
    vi.mocked(joinQueue).mockResolvedValue(waiting(6));
    const streams = streamsOpened();
    vi.mocked(getQueueStatus).mockResolvedValue(waiting(5));
    const { result } = mount();
    await advance();
    await act(async () => streams[0].push('event: position\ndata: {\n\n'));
    await advance();
    expect(streams[0].cancel).toHaveBeenCalledTimes(1);
    expect(result.current.transport).toBe('polling');
    expect(result.current.phase).toBe('waiting');
  });

  it('ignores a message that is valid JSON but not a queue status', async () => {
    vi.mocked(joinQueue).mockResolvedValue(waiting(6));
    const streams = streamsOpened();
    vi.mocked(getQueueStatus).mockResolvedValue(waiting(5));
    const { result } = mount();
    await advance();
    await act(async () => streams[0].push('event: position\ndata: {"hello":"world"}\n\n'));
    await advance();
    expect(result.current.status?.position).toBe(5); // the poll, not the nonsense
    expect(result.current.transport).toBe('polling');
  });
});

describe('useQueue: losing the connection', () => {
  beforeEach(() => {
    vi.mocked(joinQueue).mockResolvedValue(waiting(7));
    vi.mocked(openQueueStream).mockRejectedValue(apiError('INTERNAL', 503));
  });

  it(`says it is offline after ${OFFLINE_AFTER_FAILURES} failed polls in a row, and recovers by itself`, async () => {
    // Failed polls used to be swallowed: the screen froze on "updating every 3 seconds" and said nothing.
    vi.mocked(getQueueStatus).mockRejectedValue(ApiError.network());
    const { result } = mount();
    await advance();
    expect(result.current.offline).toBe(false);
    await advance(POLL_MS);
    expect(result.current.offline).toBe(false);
    await advance(POLL_MS);
    expect(result.current.offline).toBe(true);
    expect(result.current.phase).toBe('waiting'); // the place is kept; it is not an error screen

    vi.mocked(getQueueStatus).mockResolvedValue(waiting(6));
    await advance(POLL_MS);
    expect(result.current.offline).toBe(false);
    expect(result.current.status?.position).toBe(6);
  });

  it('one failed poll between good ones does not count as offline', async () => {
    vi.mocked(getQueueStatus)
      .mockRejectedValueOnce(ApiError.network())
      .mockResolvedValueOnce(waiting(6))
      .mockRejectedValueOnce(ApiError.network())
      .mockResolvedValue(waiting(5));
    const { result } = mount();
    await advance(POLL_MS * 5);
    expect(result.current.offline).toBe(false);
  });

  it('waits as long as a 429 Retry-After says, and does not call that an outage', async () => {
    vi.mocked(getQueueStatus)
      .mockRejectedValueOnce(apiError('RATE_LIMITED', 429, 20))
      .mockResolvedValue(waiting(6));
    const { result } = mount();
    await advance();
    expect(getQueueStatus).toHaveBeenCalledTimes(1);

    await advance(19_000);
    expect(getQueueStatus).toHaveBeenCalledTimes(1); // still waiting
    await advance(1_500);
    expect(getQueueStatus).toHaveBeenCalledTimes(2);
    expect(result.current.offline).toBe(false);
  });

  it('honours a 429 without Retry-After at the normal pace, and caps an absurd one', async () => {
    vi.mocked(getQueueStatus)
      .mockRejectedValueOnce(apiError('RATE_LIMITED', 429, null))
      .mockRejectedValueOnce(apiError('RATE_LIMITED', 429, 100_000))
      .mockResolvedValue(waiting(6));
    mount();
    await advance();
    await advance(POLL_MS);
    expect(getQueueStatus).toHaveBeenCalledTimes(2);
    await advance(61_000);
    expect(getQueueStatus).toHaveBeenCalledTimes(3); // capped at one minute, not 100 000 s
  });
});

describe('useQueue: losing the place', () => {
  it('shows "lost" when polling gets a 404 (the queue forgot us), and joining again starts over', async () => {
    vi.mocked(joinQueue).mockResolvedValue(waiting(7));
    vi.mocked(openQueueStream).mockRejectedValue(apiError('INTERNAL', 503));
    vi.mocked(getQueueStatus).mockRejectedValue(apiError('NOT_FOUND', 404));
    const { result } = mount();
    await advance();
    expect(result.current.phase).toBe('lost'); // not the generic error panel

    vi.mocked(getQueueStatus).mockResolvedValue(waiting(3));
    act(() => result.current.restart());
    await advance();
    expect(joinQueue).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe('waiting');
  });

  it('shows "lost" when the stream answers 404 too', async () => {
    vi.mocked(joinQueue).mockResolvedValue(waiting(7));
    vi.mocked(openQueueStream).mockRejectedValue(apiError('NOT_FOUND', 404));
    const { result } = mount();
    await advance();
    expect(result.current.phase).toBe('lost');
  });

  it('expirePass forgets the pass and shows "expired"', async () => {
    vi.mocked(joinQueue).mockResolvedValue(admitted('p_old'));
    const { result } = mount();
    await advance();
    act(() => result.current.expirePass());
    expect(result.current.phase).toBe('expired');
    expect(getPass(EVENT)).toBeNull();
  });
});

describe('useQueue: leaving and coming back', () => {
  it('closes the stream and stops polling when the screen goes away', async () => {
    vi.mocked(joinQueue).mockResolvedValue(waiting(7));
    const streams = streamsOpened();
    const { unmount } = mount();
    await advance();
    expect(streams[0].signal.aborted).toBe(false);
    unmount();
    await advance();
    expect(streams[0].signal.aborted).toBe(true);

    vi.mocked(openQueueStream).mockRejectedValue(apiError('INTERNAL', 503));
    vi.mocked(getQueueStatus).mockResolvedValue(waiting(6));
    vi.mocked(getQueueStatus).mockClear();
    await advance(POLL_MS * 5);
    expect(getQueueStatus).not.toHaveBeenCalled();
  });

  it('checks the status when the tab becomes visible again, and picks up an admission it slept through', async () => {
    vi.mocked(joinQueue).mockResolvedValue(waiting(7));
    const streams = streamsOpened();
    const { result } = mount();
    await advance();
    expect(result.current.phase).toBe('waiting');

    vi.mocked(getQueueStatus).mockResolvedValue(admitted('p_woke'));
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await advance();
    expect(result.current.phase).toBe('admitted');
    expect(getPass(EVENT)?.passToken).toBe('p_woke');
    expect(streams[0].signal.aborted).toBe(true);
  });

  it('does not ask while the tab is hidden', async () => {
    vi.mocked(joinQueue).mockResolvedValue(waiting(7));
    streamsOpened();
    mount();
    await advance();
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await advance();
    expect(getQueueStatus).not.toHaveBeenCalled();
    hidden.mockRestore();
  });
});
