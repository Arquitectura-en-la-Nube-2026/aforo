'use client';

import { LogOut, Ticket } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { es } from '@/lib/i18n/es';
import { clearSession } from '@/lib/session';
import { useSession } from '@/lib/use-session';
import { cn } from '@/lib/utils';

export function SiteHeader() {
  const { session, ready } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  const link = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex min-h-11 items-center rounded-control px-3 text-[0.95rem] font-semibold',
        active ? 'bg-primary-soft text-primary-strong' : 'text-ink hover:bg-primary-soft',
      )}
    >
      {label}
    </Link>
  );

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
        <Link href="/" className="flex min-h-11 items-center gap-2 font-display text-xl font-bold">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-white">
            <Ticket className="size-4" aria-hidden />
          </span>
          {es.brand}
        </Link>
        <nav aria-label={es.nav.mainNav} className="flex flex-wrap items-center gap-1">
          {link('/', es.nav.events, pathname === '/' || pathname.startsWith('/events'))}
          {ready && session && link('/orders', es.nav.orders, pathname.startsWith('/orders'))}
          {ready && session && (
            <>
              <span className="ml-2 hidden max-w-40 truncate text-sm text-muted sm:inline">
                {session.user.displayName}
              </span>
              <Button
                variant="ghost"
                onClick={() => {
                  clearSession();
                  router.push('/');
                }}
              >
                <LogOut aria-hidden />
                {es.nav.logout}
              </Button>
            </>
          )}
          {ready && !session && pathname !== '/login' && (
            <Button asChild variant="secondary">
              <Link href={`/login?next=${encodeURIComponent(pathname)}`}>{es.nav.login}</Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
