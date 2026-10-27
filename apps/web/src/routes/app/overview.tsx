import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { PortfolioPage } from '@/features/analytics/components/portfolio-page';
import { FiltersSearch } from '@/features/analytics/lib/filters';

export const Route = createFileRoute('/app/overview')({
  validateSearch: FiltersSearch,
  component: function OverviewRoute() {
    const search = Route.useSearch();
    const navigate = useNavigate({ from: '/app/overview' });
    return (
      <PortfolioPage
        search={search}
        onSearch={(next) => void navigate({ search: next, replace: true })}
      />
    );
  },
});
