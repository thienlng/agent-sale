import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { CalendarPage } from '@/features/lodging/components/calendar-page';
import { HotelOnly } from '@/features/lodging/components/hotel-only';
import { type CalendarSearch, CalendarSearchSchema } from '@/features/lodging/lib/calendar-search';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';
import { loadNamespace } from '@/lib/i18n';

/**
 * Lịch keeps its window, filters, expanded rows and "Tìm trống" search in the URL, so a
 * property's calendar can send staff back to the same grid (link or browser Back).
 */
export const Route = createFileRoute('/app/calendar')({
  loader: () => loadNamespace('lodging'),
  validateSearch: CalendarSearchSchema,
  component: function CalendarRoute() {
    const workspace = useCurrentWorkspace();
    const search = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });
    // Grid moves replace the entry: Back from a property returns to the latest grid.
    const onSearch = useCallback(
      (next: CalendarSearch) => void navigate({ search: next, replace: true }),
      [navigate],
    );
    return (
      <HotelOnly workspace={workspace}>
        <CalendarPage search={search} onSearch={onSearch} />
      </HotelOnly>
    );
  },
});
