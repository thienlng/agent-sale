import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { z } from 'zod';

import { HotelOnly } from '@/features/lodging/components/hotel-only';
import { PropertyCalendarPage } from '@/features/lodging/components/property-calendar/property-calendar-page';
import {
  PROPERTY_CALENDAR_VIEWS,
  type PropertyCalendarSearch,
} from '@/features/lodging/lib/property-calendar-model';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';
import { loadNamespace } from '@/lib/i18n';

/**
 * `view`: month (default) | quarter | year | list. `from`: a night of the anchor month (default
 * today's month). `unit`: one room of a rooms property (default the whole place). Invalid values
 * fall back to their defaults.
 */
const Search = z.object({
  view: z.enum(PROPERTY_CALENDAR_VIEWS).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  unit: z.uuid().optional().catch(undefined),
});

/** "Lịch căn": the calendar of one property (a lazy chunk off the shell). */
export const Route = createFileRoute('/app/calendar_/$propertyId')({
  loader: () => loadNamespace('lodging'),
  validateSearch: Search,
  component: function PropertyCalendarRoute() {
    const workspace = useCurrentWorkspace();
    const { propertyId } = Route.useParams();
    const search = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });
    const onSearch = useCallback(
      (next: PropertyCalendarSearch) => void navigate({ search: next }),
      [navigate],
    );
    return (
      <HotelOnly workspace={workspace}>
        <PropertyCalendarPage
          key={propertyId}
          propertyId={propertyId}
          search={search}
          onSearch={onSearch}
        />
      </HotelOnly>
    );
  },
});
