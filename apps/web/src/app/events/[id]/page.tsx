import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAvailability, getEvent } from '@/api/endpoints';
import { EventDetailView } from '@/components/event-detail-view';
import { LoadError } from '@/components/load-error';
import { ApiError, toSerializable } from '@/lib/errors';
import type { Availability, EventDetail } from '@/lib/types';

// Public route, rendered on the server (the plan limits SSR to `/` and `/events/:id`).
type Props = { params: Promise<{ id: string }> };

async function load(
  id: string,
): Promise<{ event: EventDetail; availability: Availability | null }> {
  const [event, availability] = await Promise.all([
    getEvent(id),
    // Inventory may not have projected the event yet: render without availability.
    getAvailability(id).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === 'NOT_FOUND') return null;
      throw error;
    }),
  ]);
  return { event, availability };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  try {
    return { title: (await getEvent(id)).name };
  } catch {
    return { title: 'Evento' };
  }
}

export default async function EventPage({ params }: Props) {
  const { id } = await params;
  let loaded;
  try {
    loaded = await load(id);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') notFound();
    return <LoadError error={toSerializable(error)} />;
  }
  return <EventDetailView initialEvent={loaded.event} initialAvailability={loaded.availability} />;
}
