import { createFileRoute } from '@tanstack/react-router';

import { DistributionManager } from '@/features/crm/components/distribution-manager';

export const Route = createFileRoute('/app/crm-settings/distribution')({
  component: DistributionManager,
});
