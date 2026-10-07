import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { es } from '@/lib/i18n/es';

export default function NotFound() {
  return (
    <div className="stub mx-auto grid max-w-md gap-4 p-8 text-center">
      <p className="font-display text-xl font-semibold">{es.detail.notFound}</p>
      <Button asChild>
        <Link href="/">{es.detail.back}</Link>
      </Button>
    </div>
  );
}
