'use client';

import { useParams } from 'next/navigation';
import { RequireSession } from '@/components/require-session';
import { PayScreen } from '@/features/orders/pay-screen';

export default function PayPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireSession>
      <PayScreen orderId={id} />
    </RequireSession>
  );
}
