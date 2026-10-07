'use client';

import { useParams } from 'next/navigation';
import { RequireSession } from '@/components/require-session';
import { QueueScreen } from '@/features/queue/queue-screen';

// Client-rendered: it depends on the session and there is nothing to precompute.
export default function QueuePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireSession>
      <QueueScreen eventId={id} />
    </RequireSession>
  );
}
