import { createFileRoute } from '@tanstack/react-router';

import { SecurityPage } from '@/features/identity/components/security-page';
import { loadNamespace } from '@/lib/i18n';

export const Route = createFileRoute('/app/settings/security')({
  loader: () => loadNamespace('security').then(() => undefined),
  component: SecurityPage,
});
