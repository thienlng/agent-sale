import { ArrowUp, Image, MessageSquareMore, Phone, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { initials } from '../lib/integrations';
import { onColor } from '../lib/website';
import type { WebsiteSettings } from '@agent-sales/contracts';

/** Static mock of the widget (launcher + open panel) drawn from the unsaved settings. */
export function WebsitePreview({ settings }: { settings: WebsiteSettings }) {
  const { t } = useTranslation();
  const tp = (key: string) => t(`channelInbox.integrations.website.preview.${key}`);
  const side = settings.position === 'left' ? 'items-start' : 'items-end';
  const brand = { backgroundColor: settings.color, color: onColor(settings.color) };
  return (
    <figure className="space-y-2" aria-label={tp('label')}>
      <figcaption className="text-sm font-medium">{tp('label')}</figcaption>
      <div
        data-testid="website-preview"
        className={`flex min-h-[22rem] flex-col justify-end gap-3 rounded-xl border bg-muted/40 p-3 ${side}`}
      >
        <div className="flex w-full max-w-72 flex-col overflow-hidden rounded-2xl border border-[#E4E7EC] bg-white text-[#1F1F1F] shadow-lg">
          <div className="flex items-center gap-2.5 border-b border-[#F3F4F6] px-3 py-2.5">
            <span
              data-testid="website-preview-avatar"
              className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full text-xs font-bold"
              style={brand}
            >
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
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{settings.agentName}</span>
              <span className="flex items-center gap-1.5 text-xs text-[#5D6470]">
                <span className="size-1.5 rounded-full bg-[#067647]" aria-hidden />
                {tp('status')}
              </span>
            </span>
            <X className="size-4 text-[#5D6470]" aria-hidden />
          </div>
          <div className="space-y-2 bg-[#F8F9FB] p-3 text-sm">
            <p className="max-w-[85%] rounded-lg rounded-tl-sm border border-[#E4E7EC] bg-white px-3 py-2">
              {settings.greeting}
            </p>
            {settings.phonePrompt ? (
              <p className="max-w-[85%] rounded-lg rounded-tl-sm border border-[#E4E7EC] bg-white px-3 py-2">
                {settings.phonePrompt}
              </p>
            ) : null}
            <span className="inline-flex items-center gap-1.5 rounded border border-[#D0D5DD] bg-white px-3 py-1 text-xs font-medium">
              <Phone className="size-3" aria-hidden />
              {settings.phoneChipText}
            </span>
          </div>
          <div className="border-t border-[#F3F4F6] p-2">
            <div className="flex items-center gap-2 rounded-lg border border-[#D0D5DD] p-1 pl-2 text-xs text-[#5D6470]">
              <Image className="size-4" aria-hidden />
              <span className="flex-1">{tp('input')}</span>
              <span className="grid size-6 place-items-center rounded" style={brand}>
                <ArrowUp className="size-3.5" aria-hidden />
              </span>
            </div>
          </div>
        </div>
        <span
          data-testid="website-preview-bubble"
          role="img"
          aria-label={tp('open')}
          className="grid size-12 place-items-center rounded-2xl shadow-lg"
          style={brand}
        >
          <MessageSquareMore className="size-6" aria-hidden />
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{tp('note')}</p>
    </figure>
  );
}
