import { createFileRoute, notFound, Outlet, redirect } from '@tanstack/react-router';

import { AppShell } from '@/components/app-shell';
import { ensureSession } from '@/lib/session';

/** Platform back-office. Non-admins see a plain 404, like the API answers them. */
export const Route = createFileRoute('/admin')({
  beforeLoad: async ({ location }) => {
    const session = await ensureSession();
    if (!session) throw redirect({ to: '/login', search: { redirect: location.href } });
    if (!session.user.isPlatformAdmin) throw notFound();
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
