import { Badge } from '@/components/ui/badge';
import { es } from '@/lib/i18n/es';
import type { OrderStatus } from '@/lib/types';

const TONE = {
  PENDING_PAYMENT: 'citrus',
  PAID: 'success',
  EXPIRED: 'neutral',
  REFUND_PENDING: 'primary',
} as const;

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={TONE[status]}>{es.status[status]}</Badge>;
}
