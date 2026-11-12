import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * The old Today address (BRN-05): "Việc hôm nay" is now the top of the statistics page. Kept so
 * notification links already sent (briefing, task reminders) still open it, hash included.
 */
export const Route = createFileRoute('/app/today')({
  beforeLoad: ({ location }) => {
    throw redirect({
      to: '/app/analytics',
      ...(location.hash ? { hash: location.hash } : {}),
      replace: true,
    });
  },
});
