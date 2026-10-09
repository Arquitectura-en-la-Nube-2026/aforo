import type { Metadata } from 'next';
import { listPublishedEvents } from '@/api/endpoints';
import { EventCard } from '@/components/event-card';
import { LoadError } from '@/components/load-error';
import { toSerializable } from '@/lib/errors';
import { es } from '@/lib/i18n/es';

// Public route, rendered on the server (the plan limits SSR to `/` and `/events/:id`).
export const metadata: Metadata = { title: es.events.title };

export default async function EventsPage() {
  let events;
  let failure = null;
  try {
    events = (await listPublishedEvents()).items;
  } catch (error) {
    failure = toSerializable(error);
  }

  return (
    <div className="grid gap-8 animate-rise">
      <div className="brand-gradient relative isolate overflow-hidden rounded-card px-6 py-10 text-white sm:px-10 sm:py-14">
        <div
          aria-hidden
          className="brand-orbit -right-24 -bottom-28 -z-10 hidden h-64 w-[34rem] opacity-90 sm:block"
        />
        <div className="grid max-w-2xl gap-3">
          <h1 className="text-4xl font-bold sm:text-5xl">{es.events.title}</h1>
          <p className="text-lg text-white/85">{es.events.intro}</p>
        </div>
      </div>

      {failure && <LoadError error={failure} />}

      {events && events.length === 0 && (
        <div className="stub grid gap-1 p-8 text-center">
          <p className="font-display text-xl font-semibold">{es.events.empty}</p>
          <p className="text-muted">{es.events.emptyHint}</p>
        </div>
      )}

      {events && events.length > 0 && (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <li key={event.id} className="grid">
              <EventCard event={event} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
