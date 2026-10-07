'use client';

import { Lock } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DateText } from '@/components/date-text';
import { Button } from '@/components/ui/button';
import { es } from '@/lib/i18n/es';
import { getPass } from '@/lib/pass';
import type { SaleState } from '@/lib/types';
import { useSession } from '@/lib/use-session';

/**
 * The one call to action on the event page. It follows `saleState` from the server: the browser
 * never compares dates to decide whether a sale is open (.claude/rules/frontend.md).
 */
export function PurchaseAction({
  eventId,
  saleState,
  salesOpensAt,
}: {
  eventId: string;
  saleState: SaleState;
  salesOpensAt: string;
}) {
  const { session, ready } = useSession();
  const [hasPass, setHasPass] = useState(false);

  useEffect(() => {
    // sessionStorage is only readable in the browser, after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasPass(getPass(eventId) !== null);
  }, [eventId]);

  if (saleState === 'CLOSED') {
    return <Notice>{es.detail.closed}</Notice>;
  }

  if (saleState === 'SCHEDULED') {
    return (
      <Notice>
        <span className="flex items-center gap-2">
          <Lock className="size-4 shrink-0" aria-hidden />
          <span>
            {es.detail.opensAt} <DateText iso={salesOpensAt} />
          </span>
        </span>
      </Notice>
    );
  }

  if (!ready) {
    return <div className="min-h-12" aria-hidden />;
  }

  if (!session) {
    return (
      <Button asChild size="lg" className="w-full">
        <Link href={`/login?next=${encodeURIComponent(`/events/${eventId}`)}`}>
          {es.detail.loginToJoin}
        </Link>
      </Button>
    );
  }

  return (
    <Button asChild size="lg" className="w-full">
      <Link href={hasPass ? `/events/${eventId}/buy` : `/events/${eventId}/queue`}>
        {hasPass ? es.detail.continueBuying : es.detail.joinQueue}
      </Link>
    </Button>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-control bg-citrus-soft px-4 py-3 text-center text-[0.95rem] font-medium text-citrus-ink">
      {children}
    </p>
  );
}
