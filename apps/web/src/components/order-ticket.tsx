import { MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import { DateText } from '@/components/date-text';
import { OrderStatusBadge } from '@/components/order-status-badge';
import { formatCents } from '@/lib/format';
import { es } from '@/lib/i18n/es';
import type { EventDetail, Order, OrderCreated } from '@/lib/types';

type OrderLike = Pick<OrderCreated, 'status' | 'totalCents' | 'unitPriceCents'> &
  Partial<Pick<Order, 'quantity' | 'sectorId'>>;

/** An order as a ticket stub: the event above the perforation, sector, quantity and total below. */
export function OrderTicket({
  order,
  event,
  heading,
  children,
}: {
  order: OrderLike;
  event: EventDetail | null;
  /** Heading level is the caller's choice; defaults to a plain paragraph styled as a title. */
  heading?: ReactNode;
  children?: ReactNode;
}) {
  const sector = event?.sectors.find((s) => s.id === order.sectorId);
  const quantity = order.quantity ?? Math.round(order.totalCents / order.unitPriceCents);

  return (
    <div className="stub">
      <div className="grid gap-2 p-5 pb-6">
        <div className="flex items-start justify-between gap-3">
          {heading ?? <p className="font-display text-2xl font-bold">{event?.name ?? '…'}</p>}
          <OrderStatusBadge status={order.status} />
        </div>
        {event && (
          <>
            <p className="flex items-center gap-1.5 text-sm text-muted">
              <MapPin className="size-4 shrink-0" aria-hidden />
              {event.venue}
            </p>
            <p className="text-sm font-medium">
              <DateText iso={event.startsAt} />
            </p>
          </>
        )}
      </div>
      <div className="stub-perforation" aria-hidden />
      <div className="grid gap-3 p-5 pt-6">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold">
            {sector ? `${sector.name} · ` : ''}
            {es.pay.tickets(quantity)}
          </span>
          <span className="num text-sm text-muted">
            {formatCents(order.unitPriceCents)} {es.buy.each}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted">{es.orders.total}</span>
          <span className="num font-display text-2xl font-bold">
            {formatCents(order.totalCents)}
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
