import { createFileRoute } from '@tanstack/react-router';

import { SaasPlansManager } from '@/features/saas/components/saas-plans-manager';

export const Route = createFileRoute('/app/crm-settings/saas-plans')({
  component: () => <SaasPlansManager />,
});
