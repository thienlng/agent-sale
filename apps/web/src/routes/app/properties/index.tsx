import { createFileRoute } from '@tanstack/react-router';

import { HotelOnly } from '@/features/lodging/components/hotel-only';
import { PropertiesPage } from '@/features/lodging/components/properties-page';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';
import { loadNamespace } from '@/lib/i18n';

export const Route = createFileRoute('/app/properties/')({
  loader: () => loadNamespace('lodging'),
  component: function PropertiesRoute() {
    const workspace = useCurrentWorkspace();
    return (
      <HotelOnly workspace={workspace}>
        <PropertiesPage />
      </HotelOnly>
    );
  },
});
