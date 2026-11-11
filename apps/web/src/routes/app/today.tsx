import { createFileRoute } from '@tanstack/react-router';

import { TodayPage } from '@/features/brain/components/today-page';
import { loadNamespace } from '@/lib/i18n';

/** Hôm nay (BRN-05): what needs doing today across every conversation of the business. */
export const Route = createFileRoute('/app/today')({
  loader: () => loadNamespace('brain').then(() => undefined),
  component: TodayPage,
});
