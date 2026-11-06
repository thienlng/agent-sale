import { createFileRoute } from '@tanstack/react-router';

import { CalendarPage } from '@/features/lodging/components/calendar-page';
import { HotelOnly } from '@/features/lodging/components/hotel-only';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';
import { loadNamespace } from '@/lib/i18n';

export const Route = createFileRoute('/app/calendar')({
  loader: () => loadNamespace('lodging'),
  component: function CalendarRoute() {
    const workspace = useCurrentWorkspace();
    return (
      <HotelOnly workspace={workspace}>
        <CalendarPage />
      </HotelOnly>
    );
  },
});
