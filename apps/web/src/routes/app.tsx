import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

import { AppShell } from '@/components/app-shell';
import { MessageUsageBanner } from '@/features/billing/components/message-usage-banner';
import { ensureSession } from '@/lib/session';

/**
 * Authenticated area: restores the session from the refresh cookie or sends the user to /login.
 * Every page here acts on one business, so without a chosen one the user picks or creates it.
 */
export const Route = createFileRoute('/app')({
  beforeLoad: async ({ location }) => {
    const session = await ensureSession();
    if (!session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    if (!session.workspaceId) {
      throw redirect({ to: session.memberships.length ? '/businesses' : '/businesses/new' });
    }
  },
  component: () => (
    <AppShell>
      <MessageUsageBanner />
      <Outlet />
    </AppShell>
  ),
});
