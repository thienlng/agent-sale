import { createFileRoute, notFound, Outlet, redirect } from '@tanstack/react-router';

import { AppShell } from '@/components/app-shell';
import { SecondFactorGate } from '@/features/admin/components/second-factor-gate';
import { loadNamespace } from '@/lib/i18n';
import { ensureSession } from '@/lib/session';

/**
 * Platform back-office. Non-admins see a plain 404, like the API answers them; admins need
 * two-step verification on and a sign-in that passed it (SecondFactorGate).
 */
export const Route = createFileRoute('/admin')({
  beforeLoad: async ({ location }) => {
    const session = await ensureSession();
    if (!session) throw redirect({ to: '/login', search: { redirect: location.href } });
    if (!session.user.isPlatformAdmin) throw notFound();
  },
  loader: () => loadNamespace('backoffice'),
  component: () => (
    <AppShell>
      <SecondFactorGate>
        <Outlet />
      </SecondFactorGate>
    </AppShell>
  ),
});
