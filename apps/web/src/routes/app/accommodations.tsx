import { createFileRoute, redirect } from '@tanstack/react-router';

/** T-155 address; the properties screen replaced it (T-160). */
export const Route = createFileRoute('/app/accommodations')({
  beforeLoad: () => {
    throw redirect({ to: '/app/properties', replace: true });
  },
});
