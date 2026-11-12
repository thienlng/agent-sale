import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { StatisticsReport } from '@/features/analytics/components/statistics-report';
import { FiltersSearch, impactRangeOf, resolveFilters } from '@/features/analytics/lib/filters';
import { SECTION_TITLE, TodayPage } from '@/features/brain/components/today-page';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';
import { industryGroup } from '@/lib/industry-group';
import { loadNamespace } from '@/lib/i18n';

/**
 * Thống kê: the business home. "Việc hôm nay" (BRN-05, what needs doing today) on top, then the
 * figures ("Báo cáo", hidden without `analytics.view`). Filters live in the URL (ids only), so a
 * view can be shared without customer data.
 */
export const Route = createFileRoute('/app/analytics')({
  validateSearch: FiltersSearch,
  // A failed load shows raw keys in "Việc hôm nay" instead of the error page: the figures stay.
  loader: () => loadNamespace('brain').catch(() => undefined),
  component: function AnalyticsRoute() {
    const { t } = useTranslation();
    const search = Route.useSearch();
    const navigate = useNavigate({ from: '/app/analytics' });
    const workspace = useCurrentWorkspace();
    const group = industryGroup(workspace.data?.industry);
    // One period for the page (MS-23, TM-12): "Rapiz đã mang lại" follows the report's dates,
    // and a range it cannot count (custom dates) shows its 30 days, which its text names.
    const impactRange = impactRangeOf(resolveFilters(search)) ?? '30d';
    return (
      // A hotel's sales are stay bookings: "Rapiz đã mang lại" counts them as such.
      <TodayPage
        title={t('analytics.title')}
        bookings={group === 'hotel'}
        service={group === 'service'}
        impactRange={impactRange}
      >
        <StatisticsReport
          search={search}
          onSearch={(next) => void navigate({ search: next, replace: true })}
          titleClassName={SECTION_TITLE}
        />
      </TodayPage>
    );
  },
});
