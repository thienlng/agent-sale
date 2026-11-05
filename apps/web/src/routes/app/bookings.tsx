import { createFileRoute } from '@tanstack/react-router';

import { BookingsPage } from '@/features/lodging/components/bookings-page';
import { HotelOnly } from '@/features/lodging/components/hotel-only';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';
import { loadNamespace } from '@/lib/i18n';

export const Route = createFileRoute('/app/bookings')({
  loader: () => loadNamespace('lodging'),
  component: function BookingsRoute() {
    const workspace = useCurrentWorkspace();
    return (
      <HotelOnly workspace={workspace}>
        <BookingsPage />
      </HotelOnly>
    );
  },
});
