import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

import { AppShell } from '@/components/app-shell';
import { ensureSession } from '@/lib/session';

/** Authenticated area: restores the session from the refresh cookie or sends the user to /login. */
export const Route = createFileRoute('/app')({
  beforeLoad: async ({ location }) => {
    if (!(await ensureSession())) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
