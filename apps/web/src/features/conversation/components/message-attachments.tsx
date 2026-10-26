import type { InboxMessageDto, SendInboxMessageRequest } from '@agent-sales/contracts';
import { FileText, ImagePlus, Paperclip } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMediaLibrary } from '../api/inbox';

type Attachment = NonNullable<SendInboxMessageRequest['attachment']>;

/** Media in a message bubble. Meta CDN links expire, so a broken image falls back to a link. */
export function MessageAttachments({ items }: { items: InboxMessageDto['attachments'] }) {
  const { t } = useTranslation();
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {items.map((a, i) =>
        a.type === 'image' || a.type === 'sticker' ? (
          <a key={i} href={a.url} target="_blank" rel="noreferrer noopener">
            <img
              src={a.url}
              alt={t('channelInbox.attachment.image')}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="max-h-60 max-w-full rounded-lg object-contain"
            />
          </a>
        ) : a.type === 'video' ? (
          <video key={i} src={a.url} controls preload="none" className="max-h-60 rounded-lg" />
        ) : a.type === 'audio' ? (
          <audio key={i} src={a.url} controls preload="none" />
        ) : (
          <a
            key={i}
            href={a.url}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-2 underline"
          >
            <FileText className="size-4" />
            {t('channelInbox.attachment.file')}
          </a>
        ),
      )}
    </div>
  );
}

/** Picks one attachment from the bot image library or an HTTPS link; sent as its own message. */
export function AttachmentPicker({
  botId,
  disabled,
  onPick,
}: {
  botId: string | null;
  disabled: boolean;
  onPick: (attachment: Attachment) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`channelInbox.attachment.${key}`);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const library = useMediaLibrary(open ? botId : null);
  const valid = /^https:\/\/\S+$/.test(url.trim()) && url.trim().length <= 2000;
  function pick(attachment: Attachment) {
    onPick(attachment);
    setUrl('');
    setOpen(false);
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled} aria-label={tr('add')}>
          <Paperclip className="size-4" />
          <span className="hidden sm:inline">{tr('add')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3 p-3">
        <p className="text-xs font-medium">{tr('library')}</p>
        {!botId ? (
          <p className="text-xs text-muted-foreground">{tr('noBot')}</p>
        ) : library.isPending ? (
          <p className="text-xs text-muted-foreground">{t('channelInbox.loading')}</p>
        ) : library.isError ? (
          <p role="alert" className="text-xs text-destructive">
            {t('channelInbox.loadError')}
          </p>
        ) : library.data?.length ? (
          <div className="grid max-h-48 grid-cols-3 gap-2 overflow-y-auto">
            {library.data.map((item) => (
              <button
                type="button"
                key={item.id}
                title={item.title}
                className="aspect-square overflow-hidden rounded-md border hover:ring-2 hover:ring-primary"
                onClick={() => pick({ type: 'image', url: item.mediaUrl })}
              >
                <img
                  src={item.mediaUrl}
                  alt={item.title}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="size-full object-cover"
                />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{tr('emptyLibrary')}</p>
        )}
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid)
              pick({
                type: /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url) ? 'image' : 'file',
                url: url.trim(),
              });
          }}
        >
          <Input
            aria-label={tr('url')}
            placeholder="https://"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <Button type="submit" size="sm" className="w-full" disabled={!valid}>
            <ImagePlus className="size-4" />
            {t('channelInbox.sales.selectAttachment')}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
