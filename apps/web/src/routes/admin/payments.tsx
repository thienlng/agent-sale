import { createFileRoute } from '@tanstack/react-router';

import { PaymentsPage } from '@/features/admin/components/backoffice/payments-page';

export const Route = createFileRoute('/admin/payments')({
  component: PaymentsPage,
});
