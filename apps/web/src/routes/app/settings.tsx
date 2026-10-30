import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { SettingsTabs } from '@/components/settings-tabs';
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
        <SettingsTabs
          label={t('wsettings.title')}
          tabs={tabs.filter((tab) => tab.show).map((tab) => ({ to: tab.to, label: t(tab.key) }))}
        />
        <Outlet />
      </section>
    );
  },
});
