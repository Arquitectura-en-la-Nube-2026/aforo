import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'min-h-11 w-full rounded-control bg-surface px-3.5 text-base text-ink shadow-[inset_0_0_0_1px_var(--color-line)] placeholder:text-muted/70 aria-[invalid=true]:shadow-[inset_0_0_0_2px_var(--color-danger)]',
        className,
      )}
      {...props}
    />
  );
}
