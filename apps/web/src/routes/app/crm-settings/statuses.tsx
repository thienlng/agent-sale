import { createFileRoute } from '@tanstack/react-router';

import { OptionsManager } from '@/features/crm/components/options-manager';

export const Route = createFileRoute('/app/crm-settings/statuses')({
  component: () => <OptionsManager kind="statuses" />,
});
