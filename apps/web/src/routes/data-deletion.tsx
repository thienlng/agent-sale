import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { DataDeletionStatus } from '@/features/channel/components/data-deletion-status';
import { AuthLayout } from '@/features/identity/components/auth-layout';

/** Public: the status link Meta's data deletion callback answers with (docs/07). No sign-in. */
const Search = z.object({
  code: z
    .string()
    .regex(/^[A-Za-z0-9]{16,64}$/)
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/data-deletion')({
  validateSearch: Search,
  component: function DataDeletionPage() {
    const { code } = Route.useSearch();
    return (
      <AuthLayout>
        <DataDeletionStatus code={code} />
      </AuthLayout>
    );
  },
});
