import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

const TABS = [
  { to: '/app/order-settings/statuses', key: 'orderSettings.tabs.statuses' },
  { to: '/app/order-settings/sources', key: 'orderSettings.tabs.sources' },
  { to: '/app/order-settings/warehouses', key: 'orderSettings.tabs.warehouses' },
] as const;

export const Route = createFileRoute('/app/order-settings')({
  component: function OrderSettingsLayout() {
    const { t } = useTranslation();
    return (
      <section className="flex flex-col gap-5">
        <h1 className="text-2xl font-semibold tracking-tight">{t('orderSettings.title')}</h1>
        <nav className="flex gap-5 border-b" aria-label={t('orderSettings.title')}>
          {TABS.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              className="-mb-px border-b-2 border-transparent pb-2.5 text-base text-muted-foreground hover:text-foreground data-[status=active]:border-primary data-[status=active]:font-medium data-[status=active]:text-foreground"
            >
              {t(tab.key)}
            </Link>
          ))}
        </nav>
        <Outlet />
      </section>
    );
  },
});
