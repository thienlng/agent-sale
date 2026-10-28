import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { z } from 'zod';

import { PortfolioPage } from '@/features/analytics/components/portfolio-page';
import { FiltersSearch } from '@/features/analytics/lib/filters';
import { useSession } from '@/lib/session';

export const Route = createFileRoute('/app/overview')({
  validateSearch: FiltersSearch.extend({ lost: z.boolean().optional().catch(undefined) }),
  component: function OverviewRoute() {
    const { lost, ...search } = Route.useSearch();
    const navigate = useNavigate({ from: '/app/overview' });
    const client = useQueryClient();
    const session = useSession();
    // After losing a business (T-079), drop everything read for a business the user left.
    useEffect(() => {
      if (!lost || !session) return;
      const member = new Set(session.memberships.map((m) => m.workspaceId));
      client.removeQueries({
        predicate: (q) => q.queryKey[0] === 'ws' && !member.has(String(q.queryKey[1])),
      });
    }, [lost, session, client]);
    return (
      <PortfolioPage
        search={search}
        lost={Boolean(lost)}
        onSearch={(next) => void navigate({ search: next, replace: true })}
      />
    );
  },
});
