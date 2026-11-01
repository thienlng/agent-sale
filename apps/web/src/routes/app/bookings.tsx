import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { HotelOnly } from '@/features/lodging/components/hotel-only';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';

export const Route = createFileRoute('/app/bookings')({
  component: function BookingsPage() {
    const workspace = useCurrentWorkspace();
    const { t } = useTranslation();
    return (
      <HotelOnly workspace={workspace}>
        <h1 className="text-xl font-semibold">{t('lodging.bookingsTitle')}</h1>
        <p role="status" className="text-sm text-muted-foreground">
          {t('lodging.loading')}
        </p>
      </HotelOnly>
    );
  },
});
