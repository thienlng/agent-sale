import { createFileRoute } from '@tanstack/react-router';

import { SecurityPage } from '@/features/identity/components/security-page';

export const Route = createFileRoute('/app/settings/security')({
  component: SecurityPage,
});
