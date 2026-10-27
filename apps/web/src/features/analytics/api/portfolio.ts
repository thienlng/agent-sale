import {
  ANALYTICS_DEFINITION_VERSION,
  AnalyticsResponse,
  roleCan,
  type AnalyticsQuery,
  type MembershipDto,
} from '@agent-sales/contracts';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { useSession } from '@/lib/session';

import { type Filters, PEOPLE_METRICS, resolveFilters, rangeProblem } from '../lib/filters';

export interface PortfolioRow {
  business: MembershipDto;
  state: 'ready' | 'forbidden' | 'error';
  people?: AnalyticsResponse;
  conversations?: AnalyticsResponse;
}

async function readBusiness(
  business: MembershipDto,
  filters: Filters,
  signal: AbortSignal,
): Promise<PortfolioRow> {
  if (!roleCan(business.role, 'analytics.view')) return { business, state: 'forbidden' };
  const base = {
    definitionVersion: ANALYTICS_DEFINITION_VERSION,
    dateRange: { from: filters.from, to: filters.to },
  };
  const read = (query: AnalyticsQuery) =>
    api('/analytics/query', AnalyticsResponse, {
      method: 'POST',
      body: query,
      workspaceId: business.workspaceId,
      signal,
    });
  try {
    const people = await read({
      ...base,
      metrics: [...PEOPLE_METRICS],
      origins: ['channel', 'manual', 'import'],
    });
    const conversations = await read({
      ...base,
      metrics: ['conversations.opened', 'messages.inbound'],
    });
    return { business, state: 'ready', people, conversations };
  } catch {
    signal.throwIfAborted();
    return { business, state: 'error' };
  }
}

/** Limit tenant fan-out; each read keeps its explicit tenant header without changing the selection. */
export async function readPortfolio(
  memberships: MembershipDto[],
  filters: Filters,
  signal: AbortSignal,
): Promise<PortfolioRow[]> {
  const rows: PortfolioRow[] = new Array(memberships.length);
  let cursor = 0;
  async function worker() {
    while (cursor < memberships.length) {
      signal.throwIfAborted();
      const index = cursor++;
      const business = memberships[index];
      if (business) rows[index] = await readBusiness(business, filters, signal);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, memberships.length) }, () => worker()));
  return rows;
}

export function usePortfolio(from?: string, to?: string) {
  const session = useSession();
  const memberships = session?.memberships ?? [];
  const filters = resolveFilters({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
  return useQuery({
    queryKey: ['portfolio', session?.user.id, memberships, filters.from, filters.to],
    queryFn: ({ signal }) => readPortfolio(memberships, filters, signal),
    enabled: Boolean(session) && !rangeProblem(filters),
    staleTime: 15_000,
  });
}
