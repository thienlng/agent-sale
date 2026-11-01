import { createFileRoute } from '@tanstack/react-router';

import { CalendarPage } from '@/features/lodging/components/calendar-page';
import { HotelOnly } from '@/features/lodging/components/hotel-only';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';

export const Route = createFileRoute('/app/calendar')({
  component: function CalendarRoute() {
    const workspace = useCurrentWorkspace();
    return (
      <HotelOnly workspace={workspace}>
        <CalendarPage />
      </HotelOnly>
    );
  },
});
