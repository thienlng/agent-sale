import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

import { AppShell } from '@/components/app-shell';
import { AssistantBubble } from '@/features/assistant/components/assistant-bubble';
import { MessageUsageBanner } from '@/features/billing/components/message-usage-banner';
import { CreateBusinessDialog } from '@/features/workspace/components/create-business-dialog';
import { PlanDialog } from '@/features/billing/components/plan-dialog';
import { ACCOUNT_PATHS } from '@/lib/account-paths';
import { ensureSession, selectWorkspace } from '@/lib/session';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';
import { useBookingReviewCount } from '@/features/lodging/api/bookings';
import { useCan } from '@/lib/permissions';
import { useTranslation } from 'react-i18next';

/**
 * Authenticated area: restores the session from the refresh cookie or sends the user to /login.
 * Business pages act on one business. Without a chosen one (several businesses and none
 * remembered, T-079) the account layer is the way in: the overview lists them, and a user with
 * none creates the first one there.
 */
export const Route = createFileRoute('/app')({
  beforeLoad: async ({ location }) => {
    let session = await ensureSession();
    if (!session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    // A shared link (e.g. "Mở hội thoại" from an order) names its business: switch to it when the
    // user belongs to it, so a new tab opens the right shop whatever was chosen last.
    const linked = (location.search as { ws?: unknown }).ws;
    if (typeof linked === 'string' && linked !== session.workspaceId && selectWorkspace(linked)) {
      session = (await ensureSession()) ?? session;
    }
    if (!session.workspaceId && !ACCOUNT_PATHS.test(location.pathname)) {
      throw redirect({ to: session.memberships.length ? '/app/overview' : '/app/businesses/new' });
    }
  },
  component: function AppLayout() {
    const { t } = useTranslation();
    const workspace = useCurrentWorkspace();
    const canViewBookings = useCan('orders.view');
    // Bot holds waiting for staff, next to "Booking" (T-161); hotels with booking access only.
    const pendingHolds =
      useBookingReviewCount({
        enabled: workspace.data?.industry === 'hotel' && canViewBookings,
      }).data?.pending ?? 0;
    return (
      <AppShell
        planDialog={(props) => <PlanDialog {...props} />}
        createBusinessDialog={(props) => <CreateBusinessDialog {...props} />}
        // Undefined only while the business is loading, so the sidebar holds the industry entries
        // instead of flashing retail ones; without a business (or on error) it falls back to retail.
        industry={workspace.data?.industry ?? (workspace.isLoading ? undefined : '')}
        navCounts={{
          '/app/bookings': {
            count: pendingHolds,
            label: t('lodging.list.pendingBotHolds', { count: pendingHolds }),
          },
        }}
      >
        <MessageUsageBanner />
        <Outlet />
        {/* Owner assistant (ADR-022): owners of the account only; the panel loads on open. */}
        <AssistantBubble />
      </AppShell>
    );
  },
});
