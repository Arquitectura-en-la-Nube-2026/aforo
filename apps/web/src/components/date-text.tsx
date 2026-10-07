import { formatDateTime, formatLongDate, formatTime } from '@/lib/format';

const FORMATTERS = {
  dateTime: formatDateTime,
  longDate: formatLongDate,
  time: formatTime,
} as const;

/**
 * A timestamp as readable text. The server and the browser can ship slightly different ICU data
 * (a narrow no-break space here, a plain space there), so the text is allowed to differ at
 * hydration instead of logging a warning.
 */
export function DateText({
  iso,
  format = 'dateTime',
}: {
  iso: string;
  format?: keyof typeof FORMATTERS;
}) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {FORMATTERS[format](iso)}
    </time>
  );
}
