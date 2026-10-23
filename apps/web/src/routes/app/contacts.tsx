import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/app/contacts')({
  component: () => {
    const { t } = useTranslation();
    return (
      <section>
        <h1 className="text-2xl font-semibold">{t('nav.contacts')}</h1>
        <p className="mt-2 text-muted-foreground">{t('common.empty')}</p>
      </section>
    );
  },
});
