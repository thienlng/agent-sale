import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { AuthLayout } from '@/features/identity/components/auth-layout';
import { ForgotPasswordForm } from '@/features/identity/components/forgot-password-form';
import { ensureSession } from '@/lib/session';

export const Route = createFileRoute('/forgot-password')({
  beforeLoad: async () => {
    if (await ensureSession()) throw redirect({ to: '/app/analytics' });
  },
  component: function ForgotPasswordPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    return (
      <AuthLayout>
        <ForgotPasswordForm
          onDone={() => {
            toast.success(t('auth.reset.done'));
            void navigate({ to: '/login' });
          }}
        />
      </AuthLayout>
    );
  },
});
