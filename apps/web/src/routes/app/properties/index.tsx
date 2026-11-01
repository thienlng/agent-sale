import { createFileRoute } from '@tanstack/react-router';

import { HotelOnly } from '@/features/lodging/components/hotel-only';
import { PropertiesPage } from '@/features/lodging/components/properties-page';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';

export const Route = createFileRoute('/app/properties/')({
  component: function PropertiesRoute() {
    const workspace = useCurrentWorkspace();
    return (
      <HotelOnly workspace={workspace}>
        <PropertiesPage />
      </HotelOnly>
    );
  },
});
