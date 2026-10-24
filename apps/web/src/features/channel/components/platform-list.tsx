import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { PlatformEntry, PlatformKey } from '../lib/integrations';
import { PlatformTile } from './platform-icon';

/** Left column of the integrations screens: one entry per platform/category. */
export function PlatformList({
  platforms,
  value,
  onChange,
}: {
  platforms: readonly PlatformEntry[];
  value: PlatformKey;
  onChange: (key: PlatformKey) => void;
}) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('channelInbox.integrations.platformsLabel')}>
      <ul className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
        {platforms.map(({ key, disabled }) => {
          const active = value === key;
          return (
            <li key={key} className="shrink-0">
              <button
                type="button"
                disabled={disabled}
                aria-current={active ? 'true' : undefined}
                onClick={() => onChange(key)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-colors md:rounded-none md:border-r-2 md:border-transparent',
                  active
                    ? 'bg-primary-soft text-foreground md:border-primary'
                    : 'hover:bg-muted/60',
                  disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
                )}
              >
                <PlatformTile platform={key} />
                <span className="whitespace-nowrap">
                  {t(`channelInbox.integrations.platforms.${key}`)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
