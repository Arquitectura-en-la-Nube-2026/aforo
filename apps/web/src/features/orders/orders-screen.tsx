'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { listMyOrders } from '@/api/endpoints';
import { DateText } from '@/components/date-text';
import { ErrorPanel } from '@/components/error-panel';
import { OrderStatusBadge } from '@/components/order-status-badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getEventCached } from '@/lib/event-cache';
import { formatCents } from '@/lib/format';
import { useResource } from '@/lib/hooks';
import { es } from '@/lib/i18n/es';
import type { Order } from '@/lib/types';

const PAGE_SIZE = 10;

export function OrdersScreen() {
  return (
    <div className="mx-auto grid max-w-3xl gap-8 animate-rise">
      <div className="grid gap-2">
        <h1 className="text-4xl font-bold sm:text-5xl">{es.orders.title}</h1>
        <p className="text-lg text-muted">{es.orders.intro}</p>
      </div>
      <OrdersPage page={0} />
    </div>
  );
}

/** One page of orders. "Ver más" mounts the next page below it, so there is no list to merge. */
function OrdersPage({ page }: { page: number }) {
  const [showNext, setShowNext] = useState(false);
  const orders = useResource(`orders:${page}`, (signal) =>
    listMyOrders(page, PAGE_SIZE, { signal }),
  );

  if (orders.error && !orders.data) {
    return <ErrorPanel error={orders.error} onRetry={orders.reload} />;
  }
  if (!orders.data) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  const { items, total } = orders.data;
  if (page === 0 && items.length === 0) {
    return (
      <div className="stub grid gap-4 p-8 text-center">
        <p className="font-display text-xl font-semibold">{es.orders.empty}</p>
        <p className="text-muted">{es.orders.emptyHint}</p>
        <Button asChild className="mx-auto">
          <Link href="/">{es.orders.browse}</Link>
        </Button>
      </div>
    );
  }

  const hasMore = (page + 1) * PAGE_SIZE < total;
  return (
    <>
      <ul className="grid gap-4">
        {items.map((order) => (
          <li key={order.orderId}>
            <OrderRow order={order} />
          </li>
        ))}
      </ul>
      {hasMore && !showNext && (
        <Button variant="secondary" onClick={() => setShowNext(true)} className="mx-auto">
          {es.orders.loadMore}
        </Button>
      )}
      {showNext && <OrdersPage page={page + 1} />}
    </>
  );
}

function OrderRow({ order }: { order: Order }) {
  const event = useResource(`event:${order.eventId}`, () => getEventCached(order.eventId));
  const name = event.data?.name;

  return (
    <article className="stub group relative transition-transform duration-200 hover:-translate-y-0.5 focus-within:-translate-y-0.5">
      <div className="flex items-center gap-4 p-5">
        <div className="grid min-w-0 flex-1 gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={order.status} />
            <span className="text-sm text-muted">
              <DateText iso={order.createdAt} />
            </span>
          </div>
          <h2 className="truncate font-display text-xl font-bold">
            <Link
              href={`/orders/${order.orderId}`}
              className="after:absolute after:inset-0 after:rounded-card focus-visible:outline-offset-4"
            >
              {name ?? es.orders.order}
            </Link>
          </h2>
          <p className="text-sm text-muted">
            {es.pay.tickets(order.quantity)} ·{' '}
            <span className="num font-semibold text-ink">{formatCents(order.totalCents)}</span>
          </p>
        </div>
        <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
      </div>
    </article>
  );
}
