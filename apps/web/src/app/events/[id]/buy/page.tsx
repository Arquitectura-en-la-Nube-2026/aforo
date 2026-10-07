'use client';

import { useParams } from 'next/navigation';
import { RequireSession } from '@/components/require-session';
import { BuyScreen } from '@/features/buy/buy-screen';

export default function BuyPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireSession>
      <BuyScreen eventId={id} />
    </RequireSession>
  );
}
