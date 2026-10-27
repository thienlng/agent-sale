import { MessageCircle, Phone, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { initials } from '../lib/integrations';
import type { WebsiteSettings } from '@agent-sales/contracts';

/** Static mock of the widget (bubble + open panel) drawn from the unsaved settings. */
export function WebsitePreview({ settings }: { settings: WebsiteSettings }) {
  const { t } = useTranslation();
  const tp = (key: string) => t(`channelInbox.integrations.website.preview.${key}`);
  const side = settings.position === 'left' ? 'items-start' : 'items-end';
  return (
    <figure className="space-y-2" aria-label={tp('label')}>
      <figcaption className="text-sm font-medium">{tp('label')}</figcaption>
      <div
        data-testid="website-preview"
        className={`flex min-h-[22rem] flex-col justify-end gap-3 rounded-xl border bg-muted/40 p-3 ${side}`}
      >
        <div className="flex w-full max-w-72 flex-col overflow-hidden rounded-2xl border bg-background shadow-lg">
          <div
            data-testid="website-preview-header"
            className="flex items-center gap-2 px-3 py-2.5 text-white"
            style={{ backgroundColor: settings.color }}
          >
            <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-white/25 text-xs font-semibold">
              {settings.avatarUrl ? (
                <img
                  src={settings.avatarUrl}
                  alt=""
                  className="size-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                initials(settings.agentName)
              )}
            </span>
            <span className="truncate text-sm font-semibold">{settings.agentName}</span>
          </div>
          <div className="space-y-2 p-3 text-sm">
            <p className="max-w-[85%] rounded-2xl rounded-tl-sm bg-muted px-3 py-2">
              {settings.greeting}
            </p>
            {settings.phonePrompt ? (
              <p className="max-w-[85%] rounded-2xl rounded-tl-sm bg-muted px-3 py-2">
                {settings.phonePrompt}
              </p>
            ) : null}
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"
              style={{ borderColor: settings.color, color: settings.color }}
            >
              <Phone className="size-3" aria-hidden />
              {settings.phoneChipText}
            </span>
          </div>
          <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
            {tp('input')}
            <Send className="size-4" style={{ color: settings.color }} aria-hidden />
          </div>
        </div>
        <span
          data-testid="website-preview-bubble"
          role="img"
          aria-label={tp('open')}
          className="grid size-12 place-items-center rounded-full text-white shadow-lg"
          style={{ backgroundColor: settings.color }}
        >
          <MessageCircle className="size-6" aria-hidden />
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{tp('note')}</p>
    </figure>
  );
}
