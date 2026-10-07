// Orders carry only `eventId` and `sectorId` (contracts/openapi/orders.yaml) and the Gateway does
// not aggregate: a screen that needs the event name asks Catalog itself. Events change rarely and
// several orders usually share one, so the in-flight/finished request is shared per event.
import { getEvent } from '@/api/endpoints';
import type { EventDetail } from '@/lib/types';

const cache = new Map<string, Promise<EventDetail>>();

export function getEventCached(eventId: string): Promise<EventDetail> {
  let pending = cache.get(eventId);
  if (!pending) {
    pending = getEvent(eventId).catch((error: unknown) => {
      cache.delete(eventId); // do not remember failures
      throw error;
    });
    cache.set(eventId, pending);
  }
  return pending;
}
