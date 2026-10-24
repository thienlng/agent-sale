import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/** Wordmark: a speech-bubble mark in the brand colour + the name (only the mark when `markOnly`). */
export function Logo({ className, markOnly }: { className?: string; markOnly?: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 text-lg font-semibold tracking-tight',
        className,
      )}
    >
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <path
          d="M6 4h20a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H14l-6.5 5.2A1 1 0 0 1 6 28.4V24a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4Z"
          className="fill-primary"
        />
        <path
          d="M11 11.5h10M11 16.5h6"
          className="stroke-primary-foreground"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      </svg>
      {markOnly ? (
        <span className="sr-only">{t('app.name')}</span>
      ) : (
        <span className="truncate">{t('app.name')}</span>
      )}
    </span>
  );
}
