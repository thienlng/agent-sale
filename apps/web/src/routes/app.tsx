import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

import { AppShell } from '@/components/app-shell';
import { ACCOUNT_PATHS } from '@/components/layout/account-sidebar';
import { PlanDialog } from '@/features/billing/components/plan-dialog';
import { ensureSession } from '@/lib/session';

/**
 * Authenticated area: restores the session from the refresh cookie or sends the user to /login.
 * Business pages act on one business. Without a chosen one (several businesses and none
 * remembered, T-079) the account layer is the way in: the overview lists them, and a user with
 * none creates the first one there.
 */
export const Route = createFileRoute('/app')({
  beforeLoad: async ({ location }) => {
    const session = await ensureSession();
    if (!session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    if (!session.workspaceId && !ACCOUNT_PATHS.test(location.pathname)) {
      throw redirect({ to: session.memberships.length ? '/app/overview' : '/app/businesses/new' });
    }
  },
  component: () => (
    <AppShell planDialog={(props) => <PlanDialog {...props} />}>
      <Outlet />
    </AppShell>
  ),
});
