import { createFileRoute } from '@tanstack/react-router';

import { IntegrationsHub } from '@/features/integration/components/integrations-hub';
import { loadNamespace } from '@/lib/i18n';

export const Route = createFileRoute('/app/integrations/')({
  loader: () => loadNamespace('integration'),
  component: IntegrationsHub,
});
