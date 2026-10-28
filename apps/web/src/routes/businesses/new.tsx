import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';

import { AuthLayout } from '@/features/identity/components/auth-layout';
import { CreateBusinessForm } from '@/features/workspace/components/create-business-form';
import { ensureSession, reloadSession, useSession } from '@/lib/session';

/** Creating a business: the first one, or another one from the avatar menu (T-079). */
export const Route = createFileRoute('/businesses/new')({
  beforeLoad: async ({ location }) => {
    if (!(await ensureSession()))
      throw redirect({ to: '/login', search: { redirect: location.href } });
  },
  component: function NewBusiness() {
    const session = useSession();
    const navigate = useNavigate();
    const router = useRouter();
    const client = useQueryClient();
    if (!session) return null;
    return (
      <AuthLayout>
        <CreateBusinessForm
          session={session}
          onCreated={async (id) => {
            client.removeQueries();
            await reloadSession(id);
            await navigate({ to: '/app/analytics' });
          }}
          onCancel={session.memberships.length > 0 ? () => router.history.back() : undefined}
        />
      </AuthLayout>
    );
  },
});
