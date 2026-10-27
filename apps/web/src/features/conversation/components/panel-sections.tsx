import { ChevronRight, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { customerDisplayName } from '../lib/inbox-list';
import type { InboxConversation, InboxMessage } from '../lib/inbox-v2-types';
import { CustomerAvatar } from './customer-avatar';
import { Hint } from './hint';
import { PanelBlock } from './panel-block';

/** Top of Meta's customer panel: photo, name, channel and the collapse arrow. */
export function PanelProfileHeader({
  conversation: c,
  pageName,
  externalUrl,
  onCollapse,
}: {
  conversation: InboxConversation;
  pageName?: string | undefined;
  externalUrl?: string | null | undefined;
  onCollapse: () => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.${key}`, options ?? {});
  const name = customerDisplayName(c, (provider, last4) => tr('v2.row.guest', { provider, last4 }));
  const provider = c.provider === 'facebook' ? 'Facebook' : 'Instagram';
  return (
    <div className="flex items-center gap-3 border-b px-4 py-3">
      <CustomerAvatar conversation={c} name={name} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {pageName ? tr('v2.header.via', { provider, page: pageName }) : provider}
        </p>
        {externalUrl ? (
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {tr('v2.header.openOn', { provider })}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}
      </div>
      <Hint label={tr('sales.collapsePanel')}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={tr('sales.collapsePanel')}
          onClick={onCollapse}
        >
          <ChevronRight />
        </Button>
      </Hint>
    </div>
  );
}

/** Pictures in the loaded part of the thread, newest first (not the whole history). */
export function sharedImages(messages: readonly InboxMessage[]): string[] {
  const urls: string[] = [];
  for (const m of [...messages].reverse())
    for (const a of m.attachments)
      if ((a.type === 'image' || a.type === 'sticker') && !urls.includes(a.url)) urls.push(a.url);
  return urls;
}

/** Meta's "Ảnh được chia sẻ": a grid that opens each picture in a new tab. */
export function SharedImagesBlock({ messages }: { messages: readonly InboxMessage[] }) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`channelInbox.meta.panel.${key}`);
  const urls = sharedImages(messages);
  return (
    <PanelBlock
      title={tr('sharedImages')}
      summary={urls.length ? String(urls.length) : tr('noImages')}
      defaultOpen={urls.length > 0}
    >
      {urls.length ? (
        <>
          <ul className="grid grid-cols-3 gap-1.5">
            {urls.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block aspect-square overflow-hidden rounded-md bg-muted"
                >
                  <img
                    src={url}
                    alt={t('channelInbox.attachment.image')}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="size-full object-cover"
                  />
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">{tr('loadedOnly')}</p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{tr('noImages')}</p>
      )}
    </PanelBlock>
  );
}
