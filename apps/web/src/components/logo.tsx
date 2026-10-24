import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/** Wordmark: the Rapiz rabbit mark + the name (only the mark when `markOnly`). */
export function Logo({ className, markOnly }: { className?: string; markOnly?: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 text-lg font-semibold tracking-tight',
        className,
      )}
    >
      <img src="/logo.png" alt="" width={28} height={28} className="size-7 shrink-0" />
      {markOnly ? (
        <span className="sr-only">{t('app.name')}</span>
      ) : (
        <span className="truncate">{t('app.name')}</span>
      )}
    </span>
  );
}
