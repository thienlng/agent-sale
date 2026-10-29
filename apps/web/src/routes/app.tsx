import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

import { AppShell } from '@/components/app-shell';
import { BusinessLogo } from '@/features/workspace/components/business-logo';
import { CreateBusinessDialog } from '@/features/workspace/components/create-business-dialog';
import { PlanDialog } from '@/features/billing/components/plan-dialog';
import { ensureSession } from '@/lib/session';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';

/** Authenticated area: restores the session from the refresh cookie or sends the user to /login. */
export const Route = createFileRoute('/app')({
  beforeLoad: async ({ location }) => {
    if (!(await ensureSession())) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  component: function AppLayout() {
    const workspace = useCurrentWorkspace();
    return (
      <AppShell
        planDialog={(props) => <PlanDialog {...props} />}
        createBusinessDialog={(props) => <CreateBusinessDialog {...props} />}
        businessLogo={<BusinessLogo />}
        industry={workspace.data?.industry}
      >
        <Outlet />
      </AppShell>
    );
  },
});
