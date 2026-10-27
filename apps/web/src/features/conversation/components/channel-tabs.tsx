import type { ChannelProvider } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Hint } from './hint';

/** What the inbox shows: private messages of a provider, or the Facebook comments entry. */
export type InboxSection = 'all' | ChannelProvider | 'fbComments';

const LIVE: readonly InboxSection[] = ['all', 'facebook', 'instagram', 'website', 'fbComments'];
/** Shown so the layout matches Meta, but not connected in Rapiz yet. */
const UNSUPPORTED = ['whatsapp', 'igComments'] as const;

/** Meta's channel tab row: all messages, Messenger, Instagram, website chat, comments. */
export function ChannelTabs({
  section,
  onSection,
}: {
  section: InboxSection;
  onSection: (section: InboxSection) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`channelInbox.meta.tabs.${key}`);
  return (
    <div
      role="tablist"
      aria-label={tr('label')}
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2 py-1.5 [scrollbar-width:none]"
    >
      {LIVE.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={section === tab}
          onClick={() => onSection(tab)}
          className={cn(
            'shrink-0 rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-foreground/80 hover:bg-muted',
            section === tab && 'bg-primary-soft font-semibold text-primary hover:bg-primary-soft',
          )}
        >
          {tr(tab)}
        </button>
      ))}
      {UNSUPPORTED.map((tab) => (
        // Not a tab: there is no list behind it. Focusable so the reason can be read.
        <Hint key={tab} label={tr('unsupported')}>
          <span
            tabIndex={0}
            aria-disabled="true"
            aria-label={`${tr(tab)} · ${tr('unsupported')}`}
            className="shrink-0 cursor-not-allowed rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground/70"
          >
            {tr(tab)}
          </span>
        </Hint>
      ))}
    </div>
  );
}
