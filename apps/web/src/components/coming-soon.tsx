import { Hammer } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Honest placeholder for navigation items that are not built yet. */
export function ComingSoon({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <section className="p-6 lg:p-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t(titleKey)}</h1>
      <div className="mt-8 flex max-w-xl items-center gap-4 rounded-xl border border-dashed p-6 text-muted-foreground">
        <Hammer className="size-6 shrink-0 text-primary" aria-hidden />
        {t('common.comingSoonBody')}
      </div>
    </section>
  );
}
