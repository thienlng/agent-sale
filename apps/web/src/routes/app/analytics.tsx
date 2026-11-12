import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { StatisticsReport } from '@/features/analytics/components/statistics-report';
import { FiltersSearch } from '@/features/analytics/lib/filters';
import { SECTION_TITLE, TodayPage } from '@/features/brain/components/today-page';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';
import { industryGroup } from '@/features/workspace/utils/industry-group';
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
    return (
      // A hotel's sales are stay bookings: "Rapiz đã mang lại" counts them as such.
      <TodayPage
        title={t('analytics.title')}
        bookings={industryGroup(workspace.data?.industry) === 'hotel'}
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
