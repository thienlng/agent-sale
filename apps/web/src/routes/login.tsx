import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { AuthLayout } from '@/features/identity/components/auth-layout';
import { LoginForm } from '@/features/identity/components/login-form';
import { ensureSession } from '@/lib/session';

/** Only same-app paths are accepted as a post-login target (no open redirect). */
const Search = z.object({
  redirect: z.string().startsWith('/').catch('/app/analytics').optional(),
});

export const Route = createFileRoute('/login')({
  validateSearch: Search,
  beforeLoad: async () => {
    if (await ensureSession()) throw redirect({ to: '/app/analytics' });
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { redirect: target } = Route.useSearch();
  // A same-app path only: one leading slash, not followed by another slash or a backslash.
  const safe = target && /^\/(?![/\\])/.test(target) ? target : '/app/analytics';
  return (
    <AuthLayout>
      <LoginForm onSuccess={() => void navigate({ to: safe })} />
    </AuthLayout>
  );
}
