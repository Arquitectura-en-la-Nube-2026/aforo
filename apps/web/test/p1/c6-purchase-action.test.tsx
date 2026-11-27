// C6 — the purchase button: PurchaseAction (src/components/purchase-action.tsx).
// Its dependencies are mocked at the module boundary: the session hook, the queue pass store and
// next/link (rendered as a plain <a>). Queries go by role and visible text, never by markup.
// Template: copy a case, give it the next TC-C6-nn ID, test one behavior per case.
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PurchaseAction } from '@/components/purchase-action';
import { formatDateTime } from '@/lib/format';
import { es } from '@/lib/i18n/es';
import { getPass } from '@/lib/pass';
import type { Session } from '@/lib/session';
import { useSession } from '@/lib/use-session';

vi.mock('@/lib/use-session', () => ({ useSession: vi.fn() }));
vi.mock('@/lib/pass', () => ({ getPass: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const EVENT = '8f1b2c3d-0000-4000-8000-000000000001';
const OPENS_AT = '2026-10-01T15:00:00Z';

const SESSION = {
  accessToken: 'token',
  expiresAt: '2026-10-01T16:00:00Z',
  user: { id: '99999999-0000-4000-8000-000000000001' },
} as unknown as Session;

const OTHER_SESSION = {
  accessToken: 'token-b',
  expiresAt: '2026-10-01T16:00:00Z',
  user: { id: '99999999-0000-4000-8000-000000000002' },
} as unknown as Session;

const PASS = { passToken: 'pass-token', passExpiresAt: '2026-10-01T15:10:00Z' };

/** Sets the doubles' answers for one case. */
function given({
  session = null as Session | null,
  ready = true,
  pass = null as ReturnType<typeof getPass>,
}) {
  vi.mocked(useSession).mockReturnValue({ session, ready });
  vi.mocked(getPass).mockReturnValue(pass);
}

describe('C6 PurchaseAction', () => {
  it('TC-C6-01 saleState CLOSED shows the closed notice and no link', () => {
    given({ session: SESSION });

    render(<PurchaseAction eventId={EVENT} saleState="CLOSED" salesOpensAt={OPENS_AT} />);

    expect(screen.getByText(es.detail.closed)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('TC-C6-02 OPEN + ready + session + no pass shows the join-queue link to /events/<id>/queue', () => {
    given({ session: SESSION, ready: true, pass: null });

    render(<PurchaseAction eventId={EVENT} saleState="OPEN" salesOpensAt={OPENS_AT} />);

    const link = screen.getByRole('link', { name: es.detail.joinQueue });
    expect(link.getAttribute('href')).toBe(`/events/${EVENT}/queue`);
  });

  it('TC-C6-03 saleState SCHEDULED shows the opening text with a <time> equal to salesOpensAt and no link', () => {
    given({ session: SESSION });
    const opensAt = '2026-12-01T15:00:00Z';

    render(<PurchaseAction eventId={EVENT} saleState="SCHEDULED" salesOpensAt={opensAt} />);

    expect(screen.getByText(es.detail.opensAt)).toBeTruthy();
    const time = screen.getByText(formatDateTime(opensAt));
    expect(time.getAttribute('datetime')).toBe(opensAt);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('TC-C6-04 OPEN while the session is not loaded yet (ready false) shows no link', () => {
    given({ session: SESSION, ready: false });

    render(<PurchaseAction eventId={EVENT} saleState="OPEN" salesOpensAt={OPENS_AT} />);

    expect(screen.queryByRole('link')).toBeNull();
  });

  it('TC-C6-05 OPEN + ready + no session shows the login link to /login?next=%2Fevents%2F<id>', () => {
    given({ session: null, ready: true });

    render(<PurchaseAction eventId={EVENT} saleState="OPEN" salesOpensAt={OPENS_AT} />);

    const link = screen.getByRole('link', { name: es.detail.loginToJoin });
    expect(link.getAttribute('href')).toBe(`/login?next=%2Fevents%2F${EVENT}`);
  });

  it('TC-C6-06 OPEN + session + live pass shows the continue-buying link to /events/<id>/buy', () => {
    given({ session: SESSION, ready: true, pass: PASS });

    render(<PurchaseAction eventId={EVENT} saleState="OPEN" salesOpensAt={OPENS_AT} />);

    const link = screen.getByRole('link', { name: es.detail.continueBuying });
    expect(link.getAttribute('href')).toBe(`/events/${EVENT}/buy`);
    expect(getPass).toHaveBeenCalledWith(EVENT);
  });

  // DEFECT: expected the join-queue link to /events/<id>/queue once buyer B (no pass) replaces
  // buyer A on the open page; observed the continue-buying link to /events/<id>/buy, because
  // hasPass is only recomputed when eventId changes (useEffect deps [eventId]), not the session.
  it.fails(
    'TC-C6-08 when the session changes to another buyer without a pass, the link goes back to the queue',
    () => {
      given({ session: SESSION, ready: true, pass: PASS });
      const { rerender } = render(
        <PurchaseAction eventId={EVENT} saleState="OPEN" salesOpensAt={OPENS_AT} />,
      );
      expect(screen.getByRole('link', { name: es.detail.continueBuying })).toBeTruthy();

      given({ session: OTHER_SESSION, ready: true, pass: null });
      rerender(<PurchaseAction eventId={EVENT} saleState="OPEN" salesOpensAt={OPENS_AT} />);

      const link = screen.getByRole('link', { name: es.detail.joinQueue });
      expect(link.getAttribute('href')).toBe(`/events/${EVENT}/queue`);
    },
  );
});
