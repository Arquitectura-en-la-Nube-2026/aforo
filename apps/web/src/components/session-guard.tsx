'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { setUnauthenticatedHandler } from '@/api/client';
import { clearSession } from '@/lib/session';

/** A 401 from any authenticated call ends the session and sends the buyer to /login. */
export function SessionGuard() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    setUnauthenticatedHandler(() => {
      clearSession();
      router.replace(`/login?expired=1&next=${encodeURIComponent(pathname)}`);
    });
    return () => setUnauthenticatedHandler(null);
  }, [router, pathname]);

  return null;
}
