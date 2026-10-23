import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/app/inbox')({
  component: () => {
    const { t } = useTranslation();
    return (
      <section>
        <h1 className="text-2xl font-semibold">{t('nav.inbox')}</h1>
        <p className="mt-2 text-muted-foreground">{t('common.empty')}</p>
      </section>
    );
  },
});
