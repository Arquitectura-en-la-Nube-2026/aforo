'use client';

import { RequireSession } from '@/components/require-session';
import { OrdersScreen } from '@/features/orders/orders-screen';

export default function OrdersPage() {
  return (
    <RequireSession>
      <OrdersScreen />
    </RequireSession>
  );
}
