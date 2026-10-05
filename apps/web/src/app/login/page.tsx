import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/app/login/login-form';

export const metadata: Metadata = { title: 'Iniciar sesión' };

export default function LoginPage() {
  // useSearchParams (the `next` and `expired` params) needs a Suspense boundary.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
