import { createFileRoute } from '@tanstack/react-router';

import { AccountsPage } from '@/features/admin/components/backoffice/accounts-page';

export const Route = createFileRoute('/admin/accounts/')({
  component: AccountsPage,
});
