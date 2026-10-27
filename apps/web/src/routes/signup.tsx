import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { AuthLayout } from '@/features/identity/components/auth-layout';
import { SignupForm } from '@/features/identity/components/signup-form';
import { ensureSession } from '@/lib/session';

/** Same-app paths only (no open redirect); `email` prefills the form (invitation links). */
const Search = z.object({
  redirect: z.string().startsWith('/').catch('/app/analytics').optional(),
  email: z.email().optional().catch(undefined),
});

export const Route = createFileRoute('/signup')({
  validateSearch: Search,
  beforeLoad: async () => {
    if (await ensureSession()) throw redirect({ to: '/app/analytics' });
  },
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const { redirect: target, email } = Route.useSearch();
  // One leading slash, not followed by another slash or a backslash.
  const safe = target && /^\/(?![/\\])/.test(target) ? target : '/app/analytics';
  return (
    <AuthLayout>
      <SignupForm defaultEmail={email} onSuccess={() => void navigate({ to: safe })} />
    </AuthLayout>
  );
}
