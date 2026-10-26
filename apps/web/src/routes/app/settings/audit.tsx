import { createFileRoute } from '@tanstack/react-router';

import { AuditPage } from '@/features/audit/components/audit-page';

export const Route = createFileRoute('/app/settings/audit')({
  component: AuditPage,
});
