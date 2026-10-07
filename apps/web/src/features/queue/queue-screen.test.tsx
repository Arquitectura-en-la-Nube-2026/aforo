// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueueScreen } from '@/features/queue/queue-screen';
import { useQueue, type QueuePhase, type QueueState } from '@/features/queue/use-queue';
import { ApiError } from '@/lib/errors';
import { es } from '@/lib/i18n/es';
import type { QueueStatus } from '@/lib/types';

vi.mock('@/features/queue/use-queue', () => ({ useQueue: vi.fn() }));
vi.mock('@/api/endpoints', () => ({
  getEvent: vi.fn().mockResolvedValue({ name: 'Festival Estéreo 2026' }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const EVENT = '8f1b2c3d-0000-4000-8000-000000000001';

const waitingStatus = (position: number): QueueStatus => ({
  eventId: EVENT,
  state: 'WAITING',
  position,
  aheadOf: position - 1,
  estimatedWaitSeconds: 90,
  passToken: null,
  passExpiresAt: null,
});
const admittedStatus = (secondsLeft: number): QueueStatus => ({
  eventId: EVENT,
  state: 'ADMITTED',
  position: 0,
  aheadOf: 0,
  estimatedWaitSeconds: 0,
  passToken: 'p_abc',
  passExpiresAt: new Date(Date.now() + secondsLeft * 1000).toISOString(),
});

function show(overrides: Partial<QueueState> & { phase: QueuePhase }) {
  const state: QueueState = {
    status: null,
    startPosition: null,
    transport: 'stream',
    offline: false,
    error: null,
    restart: vi.fn(),
    expirePass: vi.fn(),
    ...overrides,
  };
  vi.mocked(useQueue).mockReturnValue(state);
  render(<QueueScreen eventId={EVENT} />);
  return state;
}

/** What a screen reader says on its own, without the user moving: the polite live region. */
const spoken = () =>
  screen.getAllByRole('status').find((node) => node.classList.contains('sr-only'))?.textContent;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('QueueScreen headings', () => {
  const phases: Array<[QueuePhase, Partial<QueueState>]> = [
    ['joining', {}],
    ['waiting', { status: waitingStatus(12), startPosition: 20 }],
    ['admitted', { status: admittedStatus(500) }],
    ['expired', {}],
    ['lost', {}],
    ['not-open', {}],
    ['error', { error: new ApiError(500, 'INTERNAL', 'cid-9') }],
  ];

  it.each(phases)(
    '%s has exactly one level-1 heading, so a screen reader always knows where it is',
    (phase, extra) => {
      show({ phase, ...extra });
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    },
  );

  it('joining says what is happening in its heading, and is marked busy', () => {
    show({ phase: 'joining' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(es.queue.joining);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('an error names the problem in a heading and keeps the correlation id visible', () => {
    show({ phase: 'error', error: new ApiError(500, 'INTERNAL', 'cid-9') });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(es.queue.problemTitle);
    expect(screen.getByRole('alert').textContent).toContain('cid-9');
  });
});

describe('QueueScreen waiting', () => {
  it('shows the position and the people ahead', () => {
    show({ phase: 'waiting', status: waitingStatus(12), startPosition: 20 });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(es.queue.yourPosition);
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText(es.queue.ahead(11))).toBeTruthy();
  });

  it('the progress bar says what it measures, in words and as a percentage', () => {
    // It was labelled "Tu posición" while its value was a percentage: a screen reader read a position
    // name followed by "40".
    show({ phase: 'waiting', status: waitingStatus(12), startPosition: 20 });
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-label')).toBe(es.queue.progress);
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(bar.getAttribute('aria-valuetext')).toBe(es.queue.progressText(40));
  });

  it('does not hang an aria-label on the big number: the heading before it already names it', () => {
    show({ phase: 'waiting', status: waitingStatus(12), startPosition: 20 });
    expect(screen.getByText('12').getAttribute('aria-label')).toBeNull();
  });

  it('says whether the position is live or refreshed by polling', () => {
    show({ phase: 'waiting', status: waitingStatus(3), transport: 'stream' });
    expect(screen.getByText(es.queue.live)).toBeTruthy();
    cleanup();
    show({ phase: 'waiting', status: waitingStatus(3), transport: 'polling' });
    expect(screen.getByText(es.queue.polling)).toBeTruthy();
  });
});

describe('QueueScreen what a screen reader hears', () => {
  it.each([
    [3, es.queue.announcePosition(3)], // the last few positions matter
    [5, es.queue.announcePosition(5)],
    [10, es.queue.announcePosition(10)], // every tenth is a milestone
    [40, es.queue.announcePosition(40)],
    [7, ''], // a plain position in between is not announced: it would be a tick every few seconds
    [412, ''],
  ])('position %i: "%s"', (position, expected) => {
    show({ phase: 'waiting', status: waitingStatus(position), startPosition: 500 });
    expect(spoken()).toBe(expected);
  });

  it('announces the turn', () => {
    show({ phase: 'admitted', status: admittedStatus(500) });
    expect(spoken()).toBe(es.queue.announceAdmitted);
  });

  it('announces a lost connection, because nothing on screen would tell a blind buyer the number froze', () => {
    show({ phase: 'waiting', status: waitingStatus(7), offline: true });
    expect(spoken()).toBe(es.queue.announceOffline);
  });
});

describe('QueueScreen offline', () => {
  it('shows a visible notice that the place is kept, instead of "updating every 3 seconds"', () => {
    show({ phase: 'waiting', status: waitingStatus(7), transport: 'polling', offline: true });
    expect(screen.getByText(es.queue.offline)).toBeTruthy();
    expect(screen.queryByText(es.queue.polling)).toBeNull();
    expect(screen.queryByText(es.queue.live)).toBeNull();
  });

  it('shows no notice while the connection is fine', () => {
    show({ phase: 'waiting', status: waitingStatus(7), transport: 'polling', offline: false });
    expect(screen.queryByText(es.queue.offline)).toBeNull();
  });
});

describe('QueueScreen lost place', () => {
  it('explains that the queue restarted and offers to join again, which costs nothing', () => {
    const state = show({ phase: 'lost' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(es.queue.lostTitle);
    expect(screen.getByText(es.queue.lostBody)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: es.queue.rejoin }));
    expect(state.restart).toHaveBeenCalledTimes(1);
  });

  it('moves the focus to the heading so a keyboard user lands on the news', () => {
    show({ phase: 'lost' });
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('is not the generic error panel', () => {
    show({ phase: 'lost' });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('QueueScreen admitted', () => {
  it('moves the focus to the heading and links to the buy screen', () => {
    show({ phase: 'admitted', status: admittedStatus(500) });
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe(es.queue.admittedTitle);
    expect(document.activeElement).toBe(heading);
    const link = screen.getByRole('link', { name: new RegExp(es.queue.goBuy) });
    expect(link.getAttribute('href')).toBe(`/events/${EVENT}/buy`);
  });

  it('counts the pass down and, at zero, tells the hook the pass expired', async () => {
    const state = show({ phase: 'admitted', status: admittedStatus(2) });
    expect(state.expirePass).not.toHaveBeenCalled();
    await act(async () => void (await vi.advanceTimersByTimeAsync(3000)));
    expect(state.expirePass).toHaveBeenCalled();
  });

  it('shows the countdown inside the stub, labelled as the pass and not as the reservation', () => {
    show({ phase: 'admitted', status: admittedStatus(500) });
    const timer = screen.getByRole('timer');
    expect(within(timer.parentElement as HTMLElement).getByText(es.queue.passLeft)).toBeTruthy();
  });
});
