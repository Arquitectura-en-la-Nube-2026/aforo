import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { es } from '@/lib/i18n/es';

// The page itself is a client component (it needs the session), so its tab title lives here.
export const metadata: Metadata = { title: es.pay.title };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
