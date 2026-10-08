'use client';

import { getOrder } from '@/api/endpoints';
import { getEventCached } from '@/lib/event-cache';
import { useResource } from '@/lib/hooks';
import type { EventDetail, Order } from '@/lib/types';

/** Order detail polls every 2 s while PENDING_PAYMENT: the webhook arrives after the buyer returns. */
const POLL_PENDING_MS = 2000;

export function useOrder(orderId: string) {
  const resource = useResource<{ order: Order; event: EventDetail | null }>(
    `order:${orderId}`,
    async (signal) => {
      const order = await getOrder(orderId, { signal });
      // The event only adds names and dates; the order screen still works without it.
      const event = await getEventCached(order.eventId).catch(() => null);
      return { order, event };
    },
    { refreshMs: ({ order }) => (order.status === 'PENDING_PAYMENT' ? POLL_PENDING_MS : null) },
  );
  return {
    order: resource.data?.order ?? null,
    event: resource.data?.event ?? null,
    error: resource.error,
    loading: resource.loading,
    reload: resource.reload,
  };
}
