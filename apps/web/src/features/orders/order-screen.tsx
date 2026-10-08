'use client';

import { CircleCheck, Clock, Hourglass, Loader, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Countdown } from '@/components/countdown';
import { DateText } from '@/components/date-text';
import { ErrorPanel } from '@/components/error-panel';
import { OrderTicket } from '@/components/order-ticket';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrder } from '@/features/orders/use-order';
import { useCountdown } from '@/lib/hooks';
import { es } from '@/lib/i18n/es';
import { wasPaymentStarted } from '@/lib/pass';
import type { OrderStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

const CONFIRM_GRACE_MS = 10_000;

export function OrderScreen({ orderId }: { orderId: string }) {
  const { order, event, error, loading, reload } = useOrder(orderId);
  const secondsLeft = useCountdown(order?.status === 'PENDING_PAYMENT' ? order.expiresAt : null);

  // Did this browser already send the buyer to the payment page? Only known in the browser.
  const [paymentStarted, setPaymentStarted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPaymentStarted(wasPaymentStarted(orderId));
  }, [orderId]);

  // The plan promises PAID within 5 s of paying. The backend sends nothing when the buyer cancels or
  // the payment is declined (the order simply stays PENDING_PAYMENT), so after a grace period we stop
  // saying "confirming" and offer to try again instead of spinning until the reservation expires.
  const awaitingPayment = order?.status === 'PENDING_PAYMENT' && paymentStarted;
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    if (!awaitingPayment) return;
    const id = window.setTimeout(() => setGraceOver(true), CONFIRM_GRACE_MS);
    return () => window.clearTimeout(id);
  }, [awaitingPayment]);

  if (error && !order) {
    return (
      <ErrorPanel error={error} onRetry={reload}>
        <Button asChild variant="ghost">
          <Link href="/orders">{es.orders.back}</Link>
        </Button>
      </ErrorPanel>
    );
  }
  if (loading || !order) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  const status = order.status;
  const confirming = awaitingPayment && !graceOver;
  const stalled = awaitingPayment && graceOver;

  return (
    <div className="mx-auto grid max-w-xl gap-6 animate-rise">
      <Link
        href="/orders"
        className="w-fit text-sm font-semibold text-primary-strong hover:underline"
      >
        ← {es.orders.back}
      </Link>

      <StatusBanner status={status} confirming={confirming} stalled={stalled} />

      <OrderTicket order={order} event={event}>
        <dl className="grid gap-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{es.orders.placedOn}</dt>
            <dd>
              <DateText iso={order.createdAt} />
            </dd>
          </div>
          {order.paidAt && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{es.orders.paidOn}</dt>
              <dd>
                <DateText iso={order.paidAt} />
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{es.orders.order}</dt>
            <dd className="num select-all text-[0.8rem]">{order.orderId}</dd>
          </div>
        </dl>

        {status === 'PENDING_PAYMENT' && (
          <div className="grid gap-3 pt-2">
            <Countdown label={es.orders.reservedFor} seconds={secondsLeft} className="w-fit" />
            {confirming ? (
              <Link
                href={`/orders/${order.orderId}/pay`}
                className="w-fit text-sm font-semibold text-primary-strong hover:underline"
              >
                {es.orders.payAgain}
              </Link>
            ) : (
              <Button asChild size="lg">
                <Link href={`/orders/${order.orderId}/pay`}>
                  {stalled ? es.orders.tryPaymentAgain : es.orders.payNow}
                </Link>
              </Button>
            )}
          </div>
        )}
        {(status === 'EXPIRED' || status === 'PAID') && (
          <Button asChild variant="secondary" className="mt-2 w-fit">
            <Link href={`/events/${order.eventId}`}>{es.orders.backToEvent}</Link>
          </Button>
        )}
      </OrderTicket>
    </div>
  );
}

function StatusBanner({
  status,
  confirming,
  stalled,
}: {
  status: OrderStatus;
  confirming: boolean;
  stalled: boolean;
}) {
  const view: Record<string, { icon: ReactNode; title: string; body: string; tone: string }> = {
    PAID: {
      icon: <CircleCheck className="size-7" aria-hidden />,
      title: es.orders.paidTitle,
      body: es.orders.paidBody,
      tone: 'bg-success-soft text-success',
    },
    CONFIRMING: {
      icon: <Loader className="size-7 motion-safe:animate-spin" aria-hidden />,
      title: es.orders.confirmingTitle,
      body: es.orders.confirmingBody,
      tone: 'bg-primary-soft text-primary-strong',
    },
    STALLED: {
      icon: <Clock className="size-7" aria-hidden />,
      title: es.orders.stalledTitle,
      body: es.orders.stalledBody,
      tone: 'bg-citrus-soft text-citrus-ink',
    },
    PENDING_PAYMENT: {
      icon: <Clock className="size-7" aria-hidden />,
      title: es.orders.pendingTitle,
      body: es.orders.pendingBody,
      tone: 'bg-citrus-soft text-citrus-ink',
    },
    EXPIRED: {
      icon: <Hourglass className="size-7" aria-hidden />,
      title: es.orders.expiredTitle,
      body: es.orders.expiredBody,
      tone: 'bg-paper text-ink shadow-[inset_0_0_0_1px_var(--color-line)]',
    },
    REFUND_PENDING: {
      icon: <Undo2 className="size-7" aria-hidden />,
      title: es.orders.refundTitle,
      body: es.orders.refundBody,
      tone: 'bg-primary-soft text-primary-strong',
    },
  };
  const current = view[stalled ? 'STALLED' : confirming ? 'CONFIRMING' : status];

  return (
    // role=status: when polling flips PENDING_PAYMENT -> PAID the change is announced politely.
    <div role="status" className={cn('flex items-start gap-4 rounded-card p-5', current.tone)}>
      <span className="mt-0.5 shrink-0">{current.icon}</span>
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold">{current.title}</h1>
        <p className="text-[0.95rem] text-ink">{current.body}</p>
      </div>
    </div>
  );
}
