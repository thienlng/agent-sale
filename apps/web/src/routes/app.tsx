import { createFileRoute, Outlet } from '@tanstack/react-router';

import { AppShell } from '@/components/app-shell';

/** Authenticated layout. The auth guard (beforeLoad → /login) arrives with the auth task. */
export const Route = createFileRoute('/app')({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
