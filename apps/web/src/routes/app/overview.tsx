import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { PortfolioPage } from '@/features/analytics/components/portfolio-page';
import { FiltersSearch } from '@/features/analytics/lib/filters';

export const Route = createFileRoute('/app/overview')({
  validateSearch: FiltersSearch.extend({ lost: z.boolean().optional().catch(undefined) }),
  component: function OverviewRoute() {
    const { lost, ...search } = Route.useSearch();
    const navigate = useNavigate({ from: '/app/overview' });
    return (
      <PortfolioPage
        search={search}
        lost={Boolean(lost)}
        onSearch={(next) => void navigate({ search: next, replace: true })}
      />
    );
  },
});
