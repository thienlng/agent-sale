import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { AuthLayout } from '@/features/identity/components/auth-layout';
import { JoinPage } from '@/features/team/components/join-page';
import { ensureSession } from '@/lib/session';

export const Route = createFileRoute('/join')({
  validateSearch: z.object({ token: z.string().max(200).catch('') }),
  // Restores a session from the refresh cookie when there is one; no redirect either way.
  beforeLoad: async () => {
    await ensureSession();
  },
  component: function Join() {
    const { token } = Route.useSearch();
    return (
      <AuthLayout>
        <JoinPage token={token} />
      </AuthLayout>
    );
  },
});
