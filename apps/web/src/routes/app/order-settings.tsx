import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { SettingsTabs } from '@/components/settings-tabs';

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
        <SettingsTabs
          label={t('orderSettings.title')}
          tabs={TABS.map((tab) => ({ to: tab.to, label: t(tab.key) }))}
        />
        <Outlet />
      </section>
    );
  },
});
