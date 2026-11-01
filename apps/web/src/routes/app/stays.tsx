import { createFileRoute, redirect } from '@tanstack/react-router';

/** T-155 address; the bookings screen replaced it (T-160). */
export const Route = createFileRoute('/app/stays')({
  beforeLoad: () => {
    throw redirect({ to: '/app/bookings', replace: true });
  },
});
