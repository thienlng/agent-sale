import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { BusinessPicker } from '@/features/workspace/components/business-picker';
import { AuthLayout } from '@/features/identity/components/auth-layout';
import { ensureSession, selectWorkspace, useSession } from '@/lib/session';

/** Choosing a business after login, or after losing access to the current one (T-079). */
export const Route = createFileRoute('/businesses/')({
  validateSearch: z.object({ lost: z.boolean().catch(false).optional() }),
  beforeLoad: async ({ location }) => {
    const session = await ensureSession();
    if (!session) throw redirect({ to: '/login', search: { redirect: location.href } });
    if (session.memberships.length === 0) throw redirect({ to: '/businesses/new' });
  },
  component: function ChooseBusiness() {
    const session = useSession();
    const { lost } = Route.useSearch();
    const navigate = useNavigate();
    const client = useQueryClient();
    if (!session) return null;
    return (
      <AuthLayout>
        <BusinessPicker
          session={session}
          lost={Boolean(lost)}
          onChoose={(id) => {
            // Nothing read for another business may be shown in this one.
            if (id !== session.workspaceId) client.removeQueries();
            if (selectWorkspace(id)) void navigate({ to: '/app/analytics' });
          }}
          onCreate={() => void navigate({ to: '/businesses/new' })}
        />
      </AuthLayout>
    );
  },
});
