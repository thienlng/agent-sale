import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { ProvidersSection } from '@/features/admin/components/providers-section';
import { TierRoutes } from '@/features/admin/components/tier-routes';

export const Route = createFileRoute('/admin/llm')({
  component: function LlmAdmin() {
    const { t } = useTranslation();
    return (
      <div className="flex w-full flex-col gap-12">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{t('admin.title')}</h1>
          <p className="mt-1 text-muted-foreground">{t('admin.subtitle')}</p>
        </header>
        <ProvidersSection />
        <TierRoutes />
      </div>
    );
  },
});
