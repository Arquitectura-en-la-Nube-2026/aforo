'use client';

import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { createPaymentIntent } from '@/api/endpoints';
import { Countdown } from '@/components/countdown';
import { ErrorPanel } from '@/components/error-panel';
import { OrderTicket } from '@/components/order-ticket';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrder } from '@/features/orders/use-order';
import { ApiError } from '@/lib/errors';
import { useCountdown } from '@/lib/hooks';
import { es } from '@/lib/i18n/es';
import { getPass, markPaymentStarted } from '@/lib/pass';

export function PayScreen({ orderId }: { orderId: string }) {
  const { order, event, error, loading, reload } = useOrder(orderId);
  const secondsLeft = useCountdown(order?.status === 'PENDING_PAYMENT' ? order.expiresAt : null);

  // One Idempotency-Key per payment attempt. After the API answers with an error the buyer's next
  // click is a new attempt (new key); after a lost connection it is the same attempt (same key).
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [payError, setPayError] = useState<unknown>(null);

  if (error && !order) return <ErrorPanel error={error} onRetry={reload} />;
  if (loading || !order) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  const reservationOver =
    order.status === 'EXPIRED' || (order.status === 'PENDING_PAYMENT' && secondsLeft === 0);
  const notPayable = order.status !== 'PENDING_PAYMENT' || reservationOver;

  const pay = async () => {
    setSubmitting(true);
    setPayError(null);
    try {
      const pass = getPass(order.eventId)?.passToken ?? null;
      const intent = await createPaymentIntent(order.orderId, idempotencyKey, pass);
      markPaymentStarted(order.orderId);
      // Hand over to the payment page; it sends the buyer back to /orders/{id} when done.
      window.location.assign(intent.checkoutUrl);
    } catch (failure) {
      setPayError(failure);
      setSubmitting(false);
      if (failure instanceof ApiError && failure.code !== 'NETWORK') {
        setIdempotencyKey(crypto.randomUUID());
      }
    }
  };

  return (
    <div className="mx-auto grid max-w-xl gap-6 animate-rise">
      <div className="grid gap-3">
        <h1 className="text-4xl font-bold">{es.pay.title}</h1>
        {!notPayable && (
          <Countdown label={es.pay.reservedFor} seconds={secondsLeft} className="w-fit" />
        )}
      </div>

      <OrderTicket order={order} event={event}>
        {notPayable ? (
          <div className="grid gap-3 pt-2">
            <p className="font-semibold">{es.pay.notPayableTitle}</p>
            <p className="text-muted">
              {order.status === 'PAID' ? es.pay.paidBody : es.pay.expiredBody}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary">
                <Link href={`/orders/${order.orderId}`}>{es.pay.seeOrder}</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href={`/events/${order.eventId}`}>{es.orders.backToEvent}</Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 pt-2">
            {payError !== null && <ErrorPanel error={payError} />}
            <Button size="lg" disabled={submitting} onClick={pay}>
              {submitting ? es.pay.submitting : es.pay.submit}
            </Button>
            <p className="flex items-center justify-center gap-2 text-center text-sm text-muted">
              <ShieldCheck className="size-4 shrink-0" aria-hidden />
              {es.pay.mockNote}
            </p>
          </div>
        )}
      </OrderTicket>
    </div>
  );
}
