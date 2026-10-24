import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { useCan } from '@/lib/permissions';

export const Route = createFileRoute('/app/settings')({
  component: function SettingsLayout() {
    const { t } = useTranslation();
    const canAudit = useCan('audit.view');
    const tabs = [
      { to: '/app/settings/profile', key: 'wsettings.tabs.profile', show: true },
      { to: '/app/settings/security', key: 'wsettings.tabs.security', show: true },
      { to: '/app/settings/audit', key: 'wsettings.tabs.audit', show: canAudit },
    ] as const;
    return (
      <section className="flex flex-col gap-5">
        <h1 className="text-2xl font-semibold tracking-tight">{t('wsettings.title')}</h1>
        <nav className="flex gap-5 overflow-x-auto border-b" aria-label={t('wsettings.title')}>
          {tabs
            .filter((tab) => tab.show)
            .map((tab) => (
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
