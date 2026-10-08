'use client';

import { Minus, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createOrder, getAvailability, getEvent } from '@/api/endpoints';
import { Countdown } from '@/components/countdown';
import { ErrorPanel } from '@/components/error-panel';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/errors';
import { formatCents } from '@/lib/format';
import { useCountdown, useResource } from '@/lib/hooks';
import { es } from '@/lib/i18n/es';
import { clearPass, getPass, type QueuePass } from '@/lib/pass';
import { cn } from '@/lib/utils';

const REFRESH_MS = 10_000;

export function BuyScreen({ eventId }: { eventId: string }) {
  const router = useRouter();

  // The pass lives in sessionStorage, which only exists in the browser.
  const [pass, setPass] = useState<QueuePass | null | undefined>(undefined);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPass(getPass(eventId));
  }, [eventId]);

  const secondsLeft = useCountdown(pass?.passExpiresAt);
  const passExpired = pass !== undefined && (pass === null || secondsLeft === 0);
  useEffect(() => {
    if (pass && secondsLeft === 0) clearPass(eventId);
  }, [pass, secondsLeft, eventId]);

  const data = useResource(
    pass ? `buy:${eventId}` : null,
    async (signal) => {
      const [event, availability] = await Promise.all([
        getEvent(eventId, { signal }),
        getAvailability(eventId, { signal }).catch((error: unknown) => {
          if (error instanceof ApiError && error.code === 'NOT_FOUND') return null;
          throw error;
        }),
      ]);
      return { event, availability };
    },
    { refreshMs: () => REFRESH_MS },
  );

  const [sectorId, setSectorId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  // One Idempotency-Key per user attempt: reused on every retry of the same choice, and replaced
  // only when sector or quantity change (apps/web/README.md, rule 4).
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (passExpired) {
    return (
      <div className="stub mx-auto grid max-w-md gap-4 p-8 text-center animate-rise">
        <h1 className="text-3xl font-bold">{pass === null ? es.buy.noPass : es.buy.passExpired}</h1>
        <Button asChild size="lg" className="mx-auto">
          <Link href={`/events/${eventId}/queue`}>{es.buy.goQueue}</Link>
        </Button>
      </div>
    );
  }

  if (data.error && !data.data) {
    return <ErrorPanel error={data.error} onRetry={data.reload} />;
  }

  if (!data.data || !pass) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  const { event, availability } = data.data;
  const maxPerPerson = event.salesRules?.maxTicketsPerPerson ?? 1;
  const availableBySector = new Map(availability?.sectors.map((s) => [s.sectorId, s.available]));
  const selected = event.sectors.find((s) => s.id === sectorId) ?? null;
  const selectedAvailable = selected ? availableBySector.get(selected.id) : undefined;
  const maxQuantity = Math.max(1, Math.min(maxPerPerson, selectedAvailable ?? maxPerPerson));
  const safeQuantity = Math.min(quantity, maxQuantity);
  const total = selected ? selected.priceCents * safeQuantity : 0;

  const pickSector = (id: string) => {
    setSectorId(id);
    setQuantity(1);
    setIdempotencyKey(crypto.randomUUID());
    setError(null);
  };

  const changeQuantity = (next: number) => {
    setQuantity(next);
    setIdempotencyKey(crypto.randomUUID());
    setError(null);
  };

  const submit = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const order = await createOrder(
        { eventId, sectorId: selected.id, quantity: safeQuantity },
        idempotencyKey,
        pass.passToken,
      );
      router.push(`/orders/${order.orderId}/pay`);
    } catch (failure) {
      setError(failure);
      setSubmitting(false);
      // The numbers on screen may be stale after a conflict: load the real availability again.
      if (failure instanceof ApiError && failure.code === 'SOLD_OUT') data.reload();
    }
  };

  return (
    <div className="grid gap-8 animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <p className="font-semibold text-muted">{event.name}</p>
          <h1 className="text-4xl font-bold">{es.buy.title}</h1>
        </div>
        <Countdown label={es.buy.passLeft} seconds={secondsLeft} />
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:items-start">
        <div className="grid gap-8">
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-xl font-bold font-display">{es.buy.sector}</legend>
            <RadioGroup
              value={sectorId ?? ''}
              onValueChange={pickSector}
              aria-label={es.buy.sector}
              className="sm:grid-cols-2"
            >
              {event.sectors.map((sector) => {
                const available = availableBySector.get(sector.id);
                const soldOut = available === 0;
                return (
                  <RadioGroupItem
                    key={sector.id}
                    value={sector.id}
                    disabled={soldOut}
                    className={cn(
                      'grid gap-1 rounded-card bg-surface p-4 shadow-[inset_0_0_0_1px_var(--color-line)] transition-shadow',
                      'data-[state=checked]:bg-primary-soft data-[state=checked]:shadow-[inset_0_0_0_2px_var(--color-primary)]',
                      'disabled:cursor-not-allowed disabled:opacity-60',
                      !soldOut && 'hover:shadow-[inset_0_0_0_2px_var(--color-primary)]',
                    )}
                  >
                    <span className="font-display text-lg font-bold">{sector.name}</span>
                    <span className="num font-semibold">{formatCents(sector.priceCents)}</span>
                    {available !== undefined && (
                      <span
                        className={cn(
                          'text-sm',
                          soldOut ? 'font-semibold text-danger' : 'text-muted',
                        )}
                      >
                        {soldOut ? es.detail.soldOut : es.detail.available(available)}
                      </span>
                    )}
                  </RadioGroupItem>
                );
              })}
            </RadioGroup>
          </fieldset>

          <div className="grid gap-2">
            <p id="quantity-label" className="font-display text-xl font-bold">
              {es.buy.quantity}
            </p>
            <div role="group" aria-labelledby="quantity-label" className="flex items-center gap-3">
              <Button
                variant="secondary"
                size="icon"
                aria-label={es.buy.decrease}
                disabled={!selected || safeQuantity <= 1}
                onClick={() => changeQuantity(safeQuantity - 1)}
              >
                <Minus aria-hidden />
              </Button>
              <output
                aria-live="polite"
                className="num w-12 text-center font-display text-3xl font-bold"
              >
                {safeQuantity}
              </output>
              <Button
                variant="secondary"
                size="icon"
                aria-label={es.buy.increase}
                disabled={!selected || safeQuantity >= maxQuantity}
                onClick={() => changeQuantity(safeQuantity + 1)}
              >
                <Plus aria-hidden />
              </Button>
            </div>
            <p className="text-sm text-muted">{es.detail.maxPerPerson(maxPerPerson)}</p>
          </div>
        </div>

        <aside aria-label={es.buy.total} className="stub lg:sticky lg:top-6">
          <div className="grid gap-3 p-5 pb-6">
            {selected ? (
              <>
                <p className="font-semibold">
                  {selected.name} · {es.pay.tickets(safeQuantity)}
                </p>
                <p className="text-sm text-muted">
                  {formatCents(selected.priceCents)} {es.buy.each}
                </p>
              </>
            ) : (
              <p className="text-muted">{es.buy.pickSector}</p>
            )}
          </div>
          <div className="stub-perforation" aria-hidden />
          <div className="grid gap-4 p-5 pt-6">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted">{es.buy.total}</span>
              <span className="num font-display text-3xl font-bold">
                {selected ? formatCents(total) : es.buy.totalEmpty}
              </span>
            </div>
            {error !== null && <ErrorPanel error={error} />}
            <Button size="lg" disabled={!selected || submitting} onClick={submit}>
              {submitting ? es.buy.submitting : es.buy.submit}
            </Button>
            <p className="text-center text-sm text-muted">{es.buy.reserveHint}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
