import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/instrument-sans';
import './globals.css';
import { SessionGuard } from '@/components/session-guard';
import { SiteHeader } from '@/components/site-header';
import { ConfigProvider } from '@/lib/config';
import { es } from '@/lib/i18n/es';

export const metadata: Metadata = {
  title: { default: 'Aforo · Entradas para eventos en vivo', template: '%s · Aforo' },
  description: 'Entra a la fila, elige tus entradas y págalas sin perder tu lugar.',
};

export const viewport: Viewport = { themeColor: '#021557' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Render per request: the Gateway URL is runtime config (ADR-0004), not a build-time constant.
  await connection();
  const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:8080';

  return (
    <html lang="es">
      <body className="min-h-dvh">
        <ConfigProvider apiBaseUrl={apiBaseUrl}>
          <SessionGuard />
          <a
            href="#content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-ink focus:px-4 focus:py-3 focus:text-white"
          >
            {es.nav.skip}
          </a>
          <SiteHeader />
          <main id="content" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
            {children}
          </main>
        </ConfigProvider>
      </body>
    </html>
  );
}
