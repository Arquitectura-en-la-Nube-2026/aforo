'use client';

import { useParams } from 'next/navigation';
import { RequireSession } from '@/components/require-session';
import { OrderScreen } from '@/features/orders/order-screen';

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireSession>
      <OrderScreen orderId={id} />
    </RequireSession>
  );
}
