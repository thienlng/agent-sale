import { Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useInboxChannels } from '../api/inbox';
import { customerDisplayName } from '../lib/inbox-list';
import type { InboxConversation } from '../lib/inbox-v2-types';
import { CustomerAvatar } from './customer-avatar';
import { FollowUpEditor } from './follow-up-editor';
import { NotesBlock } from './notes-block';
import { PanelBlock } from './panel-block';

/** Avatar, name, channel and page, and the phone number with copy. */
export function CustomerSummary({ conversation: c }: { conversation: InboxConversation }) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.${key}`, options ?? {});
  const channels = useInboxChannels();
  const page = channels.data?.data.find((channel) => channel.id === c.channelId)?.name;
  const name = customerDisplayName(c, (provider, last4) => tr('v2.row.guest', { provider, last4 }));
  const provider =
    c.provider === 'facebook' ? 'Facebook' : c.provider === 'website' ? 'Website' : 'Instagram';
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(tr('sales.copied'));
    } catch {
      toast.error(tr('sales.copyError'));
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <CustomerAvatar conversation={c} name={name} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {page ? tr('v2.header.via', { provider, page }) : provider}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-sm">
        {c.customerPhone ? (
          <>
            <a href={`tel:${c.customerPhone}`} className="hover:underline">
              {c.customerPhone}
            </a>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={tr('sales.copyPhone')}
              onClick={() => void copy(c.customerPhone ?? '')}
            >
              <Copy />
            </Button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">{tr('v2.panel.noPhone')}</span>
        )}
      </div>
    </div>
  );
}

/** Follow-up reminder: a single line while empty, the editor once opened or set. */
export function FollowUpBlock({ conversation: c }: { conversation: InboxConversation }) {
  const { t } = useTranslation();
  return (
    <PanelBlock
      title={t('channelInbox.v2.panel.followUp')}
      summary={c.followUpAt ? undefined : t('channelInbox.v2.panel.followUpNone')}
      defaultOpen={Boolean(c.followUpAt)}
    >
      <FollowUpEditor conversation={c} />
    </PanelBlock>
  );
}

/** Default right panel when the route composes no sales panel: customer, notes, follow-up. */
export function CustomerPanel({ conversation: c }: { conversation: InboxConversation }) {
  const { t } = useTranslation();
  return (
    <div>
      <PanelBlock title={t('channelInbox.v2.panel.customer')}>
        <CustomerSummary conversation={c} />
      </PanelBlock>
      <NotesBlock conversation={c} />
      <FollowUpBlock conversation={c} />
    </div>
  );
}
