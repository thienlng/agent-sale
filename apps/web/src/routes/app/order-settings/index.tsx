import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/app/order-settings/')({
  beforeLoad: () => {
    throw redirect({ to: '/app/order-settings/statuses' });
  },
});
