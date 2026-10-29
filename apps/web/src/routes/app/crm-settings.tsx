import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { SettingsTabs } from '@/components/settings-tabs';

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
        <SettingsTabs
          label={t('crm.settings.title')}
          tabs={TABS.map((tab) => ({ to: tab.to, label: t(tab.key) }))}
        />
        <Outlet />
      </section>
    );
  },
});
