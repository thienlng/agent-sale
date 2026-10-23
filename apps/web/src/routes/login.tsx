import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { AuthLayout } from '@/features/identity/components/auth-layout';
import { LoginForm } from '@/features/identity/components/login-form';
import { ensureSession } from '@/lib/session';

/** Only same-app paths are accepted as a post-login target (no open redirect). */
const Search = z.object({ redirect: z.string().startsWith('/').catch('/app/bots').optional() });

export const Route = createFileRoute('/login')({
  validateSearch: Search,
  beforeLoad: async () => {
    if (await ensureSession()) throw redirect({ to: '/app/bots' });
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { redirect: target } = Route.useSearch();
  const safe = target && !target.startsWith('//') ? target : '/app/bots';
  return (
    <AuthLayout>
      <LoginForm onSuccess={() => void navigate({ to: safe })} />
    </AuthLayout>
  );
}
