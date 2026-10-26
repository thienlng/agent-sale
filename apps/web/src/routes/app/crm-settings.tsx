import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

const TABS = [
  { to: '/app/crm-settings/statuses', key: 'crm.settings.tabs.statuses' },
  { to: '/app/crm-settings/sources', key: 'crm.settings.tabs.sources' },
  { to: '/app/crm-settings/tags', key: 'crm.settings.tabs.tags' },
  { to: '/app/crm-settings/distribution', key: 'crm.settings.tabs.distribution' },
] as const;

export const Route = createFileRoute('/app/crm-settings')({
  component: function CrmSettingsLayout() {
    const { t } = useTranslation();
    return (
      <section className="flex flex-col gap-5">
        <h1 className="text-2xl font-semibold tracking-tight">{t('crm.settings.title')}</h1>
        <nav className="flex gap-5 overflow-x-auto border-b" aria-label={t('crm.settings.title')}>
          {TABS.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              className="-mb-px shrink-0 border-b-2 border-transparent pb-2.5 text-base text-muted-foreground hover:text-foreground data-[status=active]:border-primary data-[status=active]:font-medium data-[status=active]:text-foreground"
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
