import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { StatisticsPage } from '@/features/analytics/components/statistics-page';
import { FiltersSearch } from '@/features/analytics/lib/filters';

/** Statistics. Filters live in the URL (ids only), so a view can be shared without customer data. */
export const Route = createFileRoute('/app/analytics')({
  validateSearch: FiltersSearch,
  component: function AnalyticsRoute() {
    const search = Route.useSearch();
    const navigate = useNavigate({ from: '/app/analytics' });
    return (
      <StatisticsPage
        search={search}
        onSearch={(next) => void navigate({ search: next, replace: true })}
      />
    );
  },
});
