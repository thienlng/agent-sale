import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

import { AppShell } from '@/components/app-shell';
import { MessageUsageBanner } from '@/features/billing/components/message-usage-banner';
import { CreateBusinessDialog } from '@/features/workspace/components/create-business-dialog';
import { PlanDialog } from '@/features/billing/components/plan-dialog';
import { ACCOUNT_PATHS } from '@/lib/account-paths';
import { ensureSession } from '@/lib/session';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';

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
  component: function AppLayout() {
    const workspace = useCurrentWorkspace();
    return (
      <AppShell
        planDialog={(props) => <PlanDialog {...props} />}
        createBusinessDialog={(props) => <CreateBusinessDialog {...props} />}
        industry={workspace.data?.industry}
      >
        <MessageUsageBanner />
        <Outlet />
      </AppShell>
    );
  },
});
