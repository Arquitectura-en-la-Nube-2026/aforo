'use client';

import { AlertTriangle, Check, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/errors';
import { es } from '@/lib/i18n/es';

/**
 * Shows any failure by its `code` (never by `detail`) and always keeps the correlationId visible
 * when there is one, so a purchase can be followed through the logs.
 */
export function ErrorPanel({
  error,
  onRetry,
  children,
}: {
  error: unknown;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const view = describeError(error);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!view.correlationId) return;
    try {
      await navigator.clipboard.writeText(view.correlationId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked: the id stays selectable on screen.
    }
  };

  return (
    <div
      role="alert"
      className="rounded-card bg-danger-soft p-5 text-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-danger)_30%,transparent)]"
    >
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
        <div className="grid gap-2">
          <p className="font-display text-lg font-semibold text-danger">{view.title}</p>
          <p className="max-w-prose text-[0.95rem]">{view.body}</p>
          {view.correlationId && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <span>{es.errors.reference}:</span>
              <code className="num select-all rounded bg-surface px-1.5 py-0.5 text-[0.8rem] text-ink">
                {view.correlationId}
              </code>
              <button
                type="button"
                onClick={copy}
                className="inline-flex min-h-8 items-center gap-1 rounded px-2 text-sm font-semibold text-primary-strong hover:bg-surface"
              >
                {copied ? (
                  <Check className="size-4" aria-hidden />
                ) : (
                  <Copy className="size-4" aria-hidden />
                )}
                {copied ? es.errors.copied : es.errors.copy}
              </button>
            </p>
          )}
          {(onRetry || children) && (
            <div className="mt-1 flex flex-wrap gap-2">
              {onRetry && (
                <Button variant="secondary" onClick={onRetry}>
                  {es.common.tryAgain}
                </Button>
              )}
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
