import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/app/crm-settings/')({
  beforeLoad: () => {
    throw redirect({ to: '/app/crm-settings/statuses' });
  },
});
