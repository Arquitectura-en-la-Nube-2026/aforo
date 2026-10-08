'use client';

import { CalendarDays, MapPin } from 'lucide-react';
import Link from 'next/link';
import { getAvailability, getEvent } from '@/api/endpoints';
import { DateText } from '@/components/date-text';
import { PurchaseAction } from '@/components/purchase-action';
import { SaleBadge } from '@/components/sale-badge';
import { ApiError } from '@/lib/errors';
import { formatCents } from '@/lib/format';
import { useResource } from '@/lib/hooks';
import { es } from '@/lib/i18n/es';
import type { Availability, EventDetail } from '@/lib/types';
import { cn } from '@/lib/utils';

const REFRESH_MS = 15_000;

/**
 * The event page. It starts from what the server rendered and then refreshes every 15 s, so a
 * sale that opens (SCHEDULED -> OPEN) or a sector that sells out shows up without a reload.
 */
export function EventDetailView({
  initialEvent,
  initialAvailability,
}: {
  initialEvent: EventDetail;
  initialAvailability: Availability | null;
}) {
  const eventId = initialEvent.id;
  const live = useResource(
    `event:${eventId}`,
    async (signal) => {
      const [event, availability] = await Promise.all([
        getEvent(eventId, { signal }),
        // Inventory may not have projected the event yet (404): the page still works without it.
        getAvailability(eventId, { signal }).catch((error: unknown) => {
          if (error instanceof ApiError && error.code === 'NOT_FOUND') return null;
          throw error;
        }),
      ]);
      return { event, availability };
    },
    { refreshMs: () => REFRESH_MS },
  );

  const event = live.data?.event ?? initialEvent;
  const availability = live.data ? live.data.availability : initialAvailability;
  const rules = event.salesRules;
  const availableBySector = new Map(availability?.sectors.map((s) => [s.sectorId, s.available]));

  return (
    <div className="grid gap-10 animate-rise lg:grid-cols-[1fr_24rem] lg:items-start lg:gap-14">
      <div className="grid gap-8">
        <div className="grid gap-4">
          <Link
            href="/"
            className="w-fit text-sm font-semibold text-primary-strong hover:underline"
          >
            ← {es.detail.back}
          </Link>
          <div>
            <SaleBadge state={event.saleState} />
          </div>
          <h1 className="text-4xl font-bold sm:text-5xl">{event.name}</h1>
          <ul className="grid gap-2 text-lg">
            <li className="flex items-center gap-2.5">
              <MapPin className="size-5 shrink-0 text-muted" aria-hidden />
              {event.venue}
            </li>
            <li className="flex items-center gap-2.5">
              <CalendarDays className="size-5 shrink-0 text-muted" aria-hidden />
              <DateText iso={event.startsAt} format="longDate" />
            </li>
          </ul>
        </div>

        {rules && (
          <ul className="grid gap-1 text-muted">
            <li>{es.detail.maxPerPerson(rules.maxTicketsPerPerson)}</li>
            <li>{es.detail.ttl(Math.ceil(rules.reservationTtlSeconds / 60))}</li>
          </ul>
        )}

        <section aria-labelledby="how" className="grid gap-3">
          <h2 id="how" className="text-2xl font-bold">
            {es.detail.howItWorks}
          </h2>
          {/* A real sequence: queue, then choose, then pay. */}
          <ol className="grid gap-3">
            {es.detail.steps.map((step, index) => (
              <li key={step} className="flex items-start gap-3">
                <span className="num mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-bold text-primary-strong">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <aside aria-labelledby="sectors" className="stub flex flex-col lg:sticky lg:top-6">
        <div className="grid gap-4 p-5 pb-6">
          <div>
            <h2 id="sectors" className="text-xl font-bold">
              {es.detail.sectors}
            </h2>
            {availability && <p className="text-sm text-muted">{es.detail.sectorsHint}</p>}
          </div>
          <ul className="grid gap-4">
            {event.sectors.map((sector) => {
              const available = availableBySector.get(sector.id);
              const known = available !== undefined;
              const soldOut = known && available === 0;
              const ratio = known ? Math.min(1, available / sector.capacity) : 0;
              return (
                <li key={sector.id} className="grid gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{sector.name}</span>
                    <span className="num font-display text-lg font-bold">
                      {formatCents(sector.priceCents)}
                    </span>
                  </div>
                  {known && (
                    <>
                      <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-paper">
                        <div
                          className={cn(
                            'h-full rounded-full',
                            soldOut ? 'bg-danger' : ratio <= 0.2 ? 'bg-citrus' : 'bg-success',
                          )}
                          style={{ width: `${Math.max(soldOut ? 0 : 4, ratio * 100)}%` }}
                        />
                      </div>
                      <p
                        className={cn(
                          'text-sm',
                          soldOut ? 'font-semibold text-danger' : 'text-muted',
                        )}
                      >
                        {soldOut ? es.detail.soldOut : es.detail.available(available)}
                      </p>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <div className="stub-perforation" aria-hidden />
        <div className="p-5 pt-6">
          <PurchaseAction
            eventId={event.id}
            saleState={event.saleState}
            salesOpensAt={event.salesOpensAt}
          />
        </div>
      </aside>
    </div>
  );
}
