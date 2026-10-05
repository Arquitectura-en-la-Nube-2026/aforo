'use client';

import { Timer } from 'lucide-react';
import { formatClock } from '@/lib/format';
import { cn } from '@/lib/utils';

const DEFAULT_ANNOUNCE_AT = [60, 10];

/**
 * A deadline as mm:ss. The ticking numbers are not announced every second (that would drown a
 * screen reader); a polite message is spoken only at the thresholds in `announceAt`.
 */
export function Countdown({
  label,
  seconds,
  announceAt = DEFAULT_ANNOUNCE_AT,
  className,
}: {
  label: string;
  seconds: number | null;
  announceAt?: number[];
  className?: string;
}) {
  const urgent = seconds !== null && seconds <= 30;
  // Spoken only at the thresholds; empty the rest of the time, so a change is a new announcement.
  const spoken =
    seconds !== null && announceAt.includes(seconds) ? `${label} ${formatClock(seconds)}` : '';

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2.5 rounded-full px-4 py-2 transition-colors',
        urgent ? 'bg-danger-soft text-danger' : 'bg-citrus-soft text-citrus-ink',
        className,
      )}
    >
      <Timer className="size-4 shrink-0" aria-hidden />
      <span className="text-sm font-medium">{label}</span>
      <span role="timer" aria-live="off" className="num font-display text-lg font-bold">
        {seconds === null ? '--:--' : formatClock(seconds)}
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {spoken}
      </span>
    </div>
  );
}
