import { createFileRoute } from '@tanstack/react-router';

import { AccountDetail } from '@/features/admin/components/backoffice/account-detail';

export const Route = createFileRoute('/admin/accounts/$accountId')({
  component: function AccountRoute() {
    const { accountId } = Route.useParams();
    return <AccountDetail accountId={accountId} />;
  },
});
