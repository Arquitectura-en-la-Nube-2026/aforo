import { Badge } from '@/components/ui/badge';
import { es } from '@/lib/i18n/es';
import type { SaleState } from '@/lib/types';

const TONE = { OPEN: 'success', SCHEDULED: 'citrus', CLOSED: 'neutral' } as const;

export function SaleBadge({ state }: { state: SaleState }) {
  return (
    <Badge tone={TONE[state]}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {es.sale[state]}
    </Badge>
  );
}
