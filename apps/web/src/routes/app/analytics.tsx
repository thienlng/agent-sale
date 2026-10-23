import { createFileRoute } from '@tanstack/react-router';

import { ComingSoon } from '@/components/coming-soon';

export const Route = createFileRoute('/app/analytics')({
  component: () => <ComingSoon titleKey="nav.analytics" />,
});
