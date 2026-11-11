import { createFileRoute } from '@tanstack/react-router';

import { TodayPage } from '@/features/brain/components/today-page';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';
import { industryGroup } from '@/features/workspace/utils/industry-group';
import { loadNamespace } from '@/lib/i18n';

/** Hôm nay (BRN-05): what needs doing today across every conversation of the business. */
export const Route = createFileRoute('/app/today')({
  loader: () => loadNamespace('brain').then(() => undefined),
  component: TodayRoute,
});

function TodayRoute() {
  const workspace = useCurrentWorkspace();
  // A hotel's sales are stay bookings: "Rapiz đã mang lại" counts them as such.
  return <TodayPage bookings={industryGroup(workspace.data?.industry) === 'hotel'} />;
}
