import {
  BatteryFull,
  Camera,
  ChevronLeft,
  Image,
  Mic,
  Phone,
  Smile,
  ThumbsUp,
  Video,
  Wifi,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { AdsMessageDraft } from '../utils/ads-message';

/** Messenger conversation drawn in a phone frame, showing the ad's first message. */
export function AdsPreview({
  botName,
  themeColor,
  draft,
}: {
  botName: string;
  themeColor: string;
  draft: AdsMessageDraft | null;
}) {
  const { t } = useTranslation('training');
  const initial = botName.trim().charAt(0).toUpperCase() || '?';
  const avatar = (size: string) => (
    <span
      aria-hidden
      className={`grid ${size} shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white`}
      style={{ backgroundColor: themeColor }}
    >
      {initial}
    </span>
  );
  const replies = draft?.type === 'quick_replies' ? draft.quickReplies.filter((q) => q.title) : [];

  return (
    <div
      role="img"
      aria-label={t('space.ads.previewLabel')}
      className="mx-auto flex h-[520px] w-[260px] flex-col overflow-hidden rounded-[2.25rem] border-[7px] border-foreground bg-background shadow-lg"
    >
      <div className="relative flex items-center justify-between px-5 pt-2 pb-1 text-[10px] font-semibold">
        <span>9:41</span>
        <span className="absolute top-1.5 left-1/2 h-4 w-20 -translate-x-1/2 rounded-full bg-foreground" />
        <span className="flex items-center gap-1">
          <Wifi className="size-3" />
          <BatteryFull className="size-3.5" />
        </span>
      </div>
      <div className="flex items-center gap-2 border-b px-2 py-2">
        <ChevronLeft className="size-4 text-primary" />
        {avatar('size-7')}
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-xs font-semibold">{botName}</p>
          <p className="text-[9px] text-muted-foreground">{t('space.ads.online')}</p>
        </div>
        <Phone className="size-3.5 text-primary" />
        <Video className="size-4 text-primary" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-y-auto p-2">
        {draft && draft.type !== 'image_buttons' && draft.text.trim() ? (
          <div className="flex items-end gap-1.5">
            {avatar('size-5')}
            <p className="max-w-[80%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-xs break-words whitespace-pre-line">
              {draft.text}
            </p>
          </div>
        ) : null}
        {draft?.type === 'image_buttons' ? (
          <div className="flex items-end gap-1.5">
            {avatar('size-5')}
            <div className="w-[80%] overflow-hidden rounded-2xl border bg-background text-xs">
              {draft.imageUrl.startsWith('https://') ? (
                <img src={draft.imageUrl} alt="" className="aspect-[1.91/1] w-full object-cover" />
              ) : (
                <div className="grid aspect-[1.91/1] place-items-center bg-muted text-muted-foreground">
                  <Image className="size-6" />
                </div>
              )}
              <p className="px-3 py-2 font-semibold break-words">{draft.title || '…'}</p>
              {draft.buttons.map((b, i) => (
                <p
                  key={i}
                  className="truncate border-t px-3 py-1.5 text-center font-medium text-primary"
                >
                  {b.title || '…'}
                </p>
              ))}
            </div>
          </div>
        ) : null}
        {replies.length ? (
          <div className="flex gap-1.5 overflow-x-auto pb-1 pl-6">
            {replies.map((q, i) => (
              <span
                key={i}
                className="shrink-0 rounded-full border border-primary px-2.5 py-1 text-[11px] text-primary"
              >
                {q.title}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 px-2 py-2 text-primary">
        <Camera className="size-3.5" />
        <Image className="size-3.5" />
        <Mic className="size-3.5" />
        <span className="flex flex-1 items-center justify-between rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">
          Aa
          <Smile className="size-3.5 text-primary" />
        </span>
        <ThumbsUp className="size-4" />
      </div>
      <span className="mx-auto mb-1.5 h-1 w-20 rounded-full bg-foreground" />
    </div>
  );
}
