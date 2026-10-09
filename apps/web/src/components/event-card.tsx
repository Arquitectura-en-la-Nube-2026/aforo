import { MapPin } from 'lucide-react';
import Link from 'next/link';
import { DateText } from '@/components/date-text';
import { SaleBadge } from '@/components/sale-badge';
import { formatCents } from '@/lib/format';
import { es } from '@/lib/i18n/es';
import type { EventDetail } from '@/lib/types';

/** One event as a ticket stub: what it is above the perforation, what it costs below. */
export function EventCard({ event }: { event: EventDetail }) {
  const lowestPrice = Math.min(...event.sectors.map((sector) => sector.priceCents));

  return (
    <article className="stub group relative flex flex-col transition-[translate,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-[0_0_0_1px_var(--color-primary),0_18px_32px_-18px_var(--color-primary)] focus-within:-translate-y-1">
      {/* Brand band: the logo's gradient and ring, so the catalog reads as Aforo at a glance. */}
      <div className="brand-gradient relative isolate h-20 overflow-hidden rounded-t-card px-5 pt-4">
        <div aria-hidden className="brand-orbit -right-10 -bottom-12 -z-10 h-24 w-56" />
        <SaleBadge state={event.saleState} />
      </div>
      <div className="grid flex-1 gap-3 p-5 pb-6">
        <h2 className="text-2xl font-bold">
          {/* Stretched link: the whole card is one target, and one link for assistive tech. */}
          <Link
            href={`/events/${event.id}`}
            className="after:absolute after:inset-0 after:rounded-card focus-visible:outline-offset-4"
          >
            {event.name}
          </Link>
        </h2>
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <MapPin className="size-4 shrink-0" aria-hidden />
          {event.venue}
        </p>
        <p className="text-sm font-medium">
          <DateText iso={event.startsAt} />
        </p>
      </div>
      <div className="stub-perforation" aria-hidden />
      <div className="flex items-baseline justify-between gap-3 p-5 pt-6">
        <span className="text-sm text-muted">{es.events.from}</span>
        <span className="num font-display text-xl font-bold text-primary">
          {formatCents(lowestPrice)}
        </span>
      </div>
    </article>
  );
}
