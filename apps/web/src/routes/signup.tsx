import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';

import { AuthLayout } from '@/features/identity/components/auth-layout';
import { SignupForm } from '@/features/identity/components/signup-form';
import { ensureSession } from '@/lib/session';

export const Route = createFileRoute('/signup')({
  beforeLoad: async () => {
    if (await ensureSession()) throw redirect({ to: '/app/bots' });
  },
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  return (
    <AuthLayout>
      <SignupForm onSuccess={() => void navigate({ to: '/app/bots' })} />
    </AuthLayout>
  );
}
