'use client';

import { useRouter } from 'next/navigation';
import { ErrorPanel } from '@/components/error-panel';
import { ApiError, type SerializableError } from '@/lib/errors';

/**
 * A server-side load failed (the API was unreachable): let the buyer re-run the render. The error
 * crosses the server/client boundary as plain data (class instances cannot be serialized).
 */
export function LoadError({ error }: { error: SerializableError }) {
  const router = useRouter();
  return (
    <ErrorPanel
      error={new ApiError(error.status, error.code, error.correlationId)}
      onRetry={() => router.refresh()}
    />
  );
}
