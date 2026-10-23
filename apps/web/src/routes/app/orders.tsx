import { createFileRoute } from '@tanstack/react-router';

import { ComingSoon } from '@/components/coming-soon';

export const Route = createFileRoute('/app/orders')({
  component: () => <ComingSoon titleKey="nav.orders" />,
});
