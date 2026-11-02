import { createFileRoute } from '@tanstack/react-router';

import { PlansPage } from '@/features/admin/components/backoffice/plans-page';

export const Route = createFileRoute('/admin/plans')({
  component: PlansPage,
});
