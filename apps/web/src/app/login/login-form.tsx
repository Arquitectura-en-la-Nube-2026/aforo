'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { login } from '@/api/endpoints';
import { ErrorPanel } from '@/components/error-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { es } from '@/lib/i18n/es';
import { safeNext } from '@/lib/safe-next';
import { saveSession } from '@/lib/session';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const emailId = useId();
  const nameId = useId();

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; name?: string }>({});
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const next: typeof fieldErrors = {};
    if (!EMAIL.test(email.trim())) next.email = es.login.emailInvalid;
    if (displayName.trim().length < 1 || displayName.trim().length > 80)
      next.name = es.login.nameRequired;
    setFieldErrors(next);
    if (next.email || next.name) return;

    setSubmitting(true);
    setError(null);
    try {
      const session = await login({ email: email.trim(), displayName: displayName.trim() });
      saveSession(session);
      router.replace(safeNext(params.get('next'), window.location.origin));
    } catch (failure) {
      setError(failure);
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-md gap-6 animate-rise">
      <div className="grid gap-2">
        <h1 className="text-4xl font-bold">{es.login.title}</h1>
        <p className="text-muted">{es.login.intro}</p>
      </div>

      {params.get('expired') && (
        <p role="status" className="rounded-card bg-citrus-soft px-4 py-3 text-sm text-citrus-ink">
          {es.login.sessionExpired}
        </p>
      )}

      <form onSubmit={onSubmit} noValidate className="stub grid gap-5 overflow-hidden p-6">
        <div aria-hidden className="brand-gradient -mx-6 -mt-6 h-1.5" />
        <div className="grid gap-1.5">
          <Label htmlFor={emailId}>{es.login.email}</Label>
          <Input
            id={emailId}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={`${emailId}-hint`}
            placeholder="ana@correo.com"
          />
          <p
            id={`${emailId}-hint`}
            className={fieldErrors.email ? 'text-sm text-danger' : 'text-sm text-muted'}
          >
            {fieldErrors.email ?? es.login.emailHint}
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={nameId}>{es.login.name}</Label>
          <Input
            id={nameId}
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={80}
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={fieldErrors.name ? `${nameId}-error` : undefined}
            placeholder="Ana"
          />
          {fieldErrors.name && (
            <p id={`${nameId}-error`} className="text-sm text-danger">
              {fieldErrors.name}
            </p>
          )}
        </div>

        {error !== null && <ErrorPanel error={error} />}

        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? es.login.submitting : es.login.submit}
        </Button>
      </form>
    </div>
  );
}
