'use client';

import { ArrowRight, Radio, TicketCheck, TimerOff, Unplug, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { getEvent } from '@/api/endpoints';
import { Countdown } from '@/components/countdown';
import { ErrorPanel } from '@/components/error-panel';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useQueue, type Transport } from '@/features/queue/use-queue';
import { useCountdown, useResource } from '@/lib/hooks';
import { es } from '@/lib/i18n/es';
import { cn } from '@/lib/utils';

/** "3 minutos", or "menos de un minuto" below one. */
function waitText(seconds: number): string {
  return seconds < 60 ? es.queue.lessThanMinute : es.queue.minutes(Math.ceil(seconds / 60));
}

export function QueueScreen({ eventId }: { eventId: string }) {
  const queue = useQueue(eventId);
  const event = useResource(`event-name:${eventId}`, (signal) => getEvent(eventId, { signal }));
  const secondsLeft = useCountdown(queue.phase === 'admitted' ? queue.status?.passExpiresAt : null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // At zero the pass is gone and the buyer goes back to the line. It is never renewed on its own.
  const { expirePass } = queue;
  useEffect(() => {
    if (queue.phase === 'admitted' && secondsLeft === 0) expirePass();
  }, [queue.phase, secondsLeft, expirePass]);

  // Screen readers: say something only when it matters, never on every position tick.
  const position = queue.status?.position;
  let spoken = '';
  if (queue.phase === 'admitted') spoken = es.queue.announceAdmitted;
  else if (queue.phase === 'waiting' && queue.offline) spoken = es.queue.announceOffline;
  else if (
    queue.phase === 'waiting' &&
    position !== undefined &&
    (position <= 5 || position % 10 === 0)
  ) {
    spoken = es.queue.announcePosition(position);
  }

  // When the turn arrives or ends, move focus to the new heading so keyboard users land on it.
  useEffect(() => {
    if (
      queue.phase === 'admitted' ||
      queue.phase === 'expired' ||
      queue.phase === 'lost' ||
      queue.phase === 'not-open'
    ) {
      headingRef.current?.focus();
    }
  }, [queue.phase]);

  const eventName = event.data?.name;

  return (
    <div className="mx-auto grid max-w-xl gap-6 animate-rise">
      <div className="grid gap-1">
        <p className="text-sm font-semibold text-muted">{es.queue.title}</p>
        {eventName ? (
          <p className="font-display text-2xl font-bold">{eventName}</p>
        ) : (
          <Skeleton className="h-8 w-2/3" />
        )}
      </div>

      <div className="sr-only" role="status" aria-live="polite">
        {spoken}
      </div>

      {queue.phase === 'joining' && (
        <div className="stub grid gap-4 p-8" aria-busy="true">
          <h1 className="font-display text-xl font-semibold">{es.queue.joining}</h1>
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {queue.phase === 'waiting' && queue.status && (
        <Waiting
          position={queue.status.position}
          aheadOf={queue.status.aheadOf}
          estimatedWaitSeconds={queue.status.estimatedWaitSeconds}
          startPosition={queue.startPosition}
          transport={queue.transport}
          offline={queue.offline}
        />
      )}

      {queue.phase === 'admitted' && (
        <div className="stub">
          <div className="grid gap-4 p-8 text-center">
            <TicketCheck className="mx-auto size-10 text-success" aria-hidden />
            <h1 ref={headingRef} tabIndex={-1} className="text-4xl font-bold outline-none">
              {es.queue.admittedTitle}
            </h1>
            <p className="text-muted">{es.queue.admittedBody}</p>
            <div className="mx-auto">
              <Countdown label={es.queue.passLeft} seconds={secondsLeft} />
            </div>
          </div>
          <div className="stub-perforation" aria-hidden />
          <div className="p-6">
            <Button asChild size="lg" className="w-full">
              <Link href={`/events/${eventId}/buy`}>
                {es.queue.goBuy}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      )}

      {queue.phase === 'expired' && (
        <div className="stub grid gap-4 p-8 text-center">
          <TimerOff className="mx-auto size-10 text-danger" aria-hidden />
          <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-bold outline-none">
            {es.queue.passExpiredTitle}
          </h1>
          <p className="mx-auto max-w-sm text-muted">{es.queue.passExpiredBody}</p>
          <Button size="lg" onClick={queue.restart} className="mx-auto">
            {es.queue.rejoin}
          </Button>
        </div>
      )}

      {queue.phase === 'lost' && (
        <div className="stub grid gap-4 p-8 text-center">
          <Unplug className="mx-auto size-10 text-danger" aria-hidden />
          <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-bold outline-none">
            {es.queue.lostTitle}
          </h1>
          <p className="mx-auto max-w-sm text-muted">{es.queue.lostBody}</p>
          <Button size="lg" onClick={queue.restart} className="mx-auto">
            {es.queue.rejoin}
          </Button>
        </div>
      )}

      {queue.phase === 'not-open' && (
        <div className="stub grid gap-4 p-8 text-center">
          <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-bold outline-none">
            {es.queue.saleNotOpenTitle}
          </h1>
          <p className="text-muted">{es.queue.saleNotOpenBody}</p>
          <Button asChild variant="secondary" className="mx-auto">
            <Link href={`/events/${eventId}`}>{es.queue.backToEvent}</Link>
          </Button>
        </div>
      )}

      {queue.phase === 'error' && (
        <>
          <h1 className="sr-only">{es.queue.problemTitle}</h1>
          <ErrorPanel error={queue.error} onRetry={queue.restart}>
            <Button asChild variant="ghost">
              <Link href={`/events/${eventId}`}>{es.queue.backToEvent}</Link>
            </Button>
          </ErrorPanel>
        </>
      )}
    </div>
  );
}

function Waiting({
  position,
  aheadOf,
  estimatedWaitSeconds,
  startPosition,
  transport,
  offline,
}: {
  position: number;
  aheadOf: number;
  estimatedWaitSeconds: number;
  startPosition: number | null;
  transport: Transport;
  offline: boolean;
}) {
  // How far along the line we are: 0 % when we joined, 100 % when it is our turn.
  const total = Math.max(startPosition ?? position, position, 1);
  const progress = Math.round(((total - position) / total) * 100);

  return (
    <section aria-label={es.queue.title} className="stub">
      <div className="grid gap-5 p-8 text-center">
        <h1 className="text-lg font-semibold text-muted">{es.queue.yourPosition}</h1>
        <p
          key={position}
          className="num animate-rise font-display text-[clamp(5.5rem,26vw,9rem)] font-extrabold leading-none tracking-tight text-primary"
        >
          {position}
        </p>
        <div
          role="progressbar"
          aria-label={es.queue.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-valuetext={es.queue.progressText(progress)}
          className="mx-auto h-2 w-full max-w-xs overflow-hidden rounded-full bg-paper"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-700"
            style={{ width: `${Math.max(4, progress)}%` }}
          />
        </div>
        <p className="font-medium">{es.queue.ahead(aheadOf)}</p>
        <p className="text-muted">
          {es.queue.estimated}:{' '}
          <span className="num font-semibold text-ink">{waitText(estimatedWaitSeconds)}</span>
        </p>
      </div>
      <div className="stub-perforation" aria-hidden />
      <div className="grid gap-2 p-6">
        <p className="text-center text-[0.95rem]">{es.queue.keepOpen}</p>
        {offline ? (
          <p className="flex items-center justify-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            <WifiOff aria-hidden className="size-4 shrink-0" />
            {es.queue.offline}
          </p>
        ) : (
          <p className="flex items-center justify-center gap-2 text-sm text-muted">
            <Radio
              aria-hidden
              className={cn('size-4', transport === 'stream' ? 'text-success' : 'text-muted')}
            />
            {transport === 'stream'
              ? es.queue.live
              : transport === 'polling'
                ? es.queue.polling
                : es.queue.reconnecting}
          </p>
        )}
      </div>
    </section>
  );
}
