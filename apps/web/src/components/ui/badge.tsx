import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.8rem] font-semibold leading-none',
  {
    variants: {
      tone: {
        neutral: 'bg-paper text-muted shadow-[inset_0_0_0_1px_var(--color-line)]',
        primary: 'bg-primary-soft text-primary-strong',
        citrus: 'bg-citrus-soft text-citrus-ink',
        success: 'bg-success-soft text-success',
        danger: 'bg-danger-soft text-danger',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
