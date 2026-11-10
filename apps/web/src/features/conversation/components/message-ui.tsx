import type { InboxMessageDto } from '@agent-sales/contracts';
import { ArrowRight, ArrowUpRight, ImageOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * What the website visitor saw under a bot message (ADR-029): product cards and the suggested
 * next steps. Read-only here: staff see them as the visitor did, without acting on them.
 */
export function MessageUi({ ui }: { ui: InboxMessageDto['ui'] }) {
  const { t } = useTranslation();
  const cards = ui?.cards ?? [];
  const suggestions = ui?.suggestions ?? [];
  if (!cards.length && !suggestions.length) return null;
  return (
    <div className="mt-1 flex max-w-full flex-col items-end gap-1.5">
      {cards.length ? (
        <ul
          aria-label={t('channelInbox.v2.thread.cards')}
          className="flex max-w-full gap-2 overflow-x-auto pb-1"
        >
          {cards.map((c) => (
            <li
              key={c.productId}
              className="w-36 shrink-0 overflow-hidden rounded-lg border bg-background text-left"
            >
              {c.imageUrl ? (
                <img
                  src={c.imageUrl}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="aspect-[4/3] w-full object-cover"
                />
              ) : (
                <div className="flex aspect-[4/3] w-full items-center justify-center bg-muted text-muted-foreground">
                  <ImageOff className="size-5" aria-hidden />
                </div>
              )}
              <div className="p-2">
                <p className="line-clamp-2 text-xs font-semibold">{c.title}</p>
                {c.price ? <p className="text-xs text-muted-foreground">{c.price}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {suggestions.length ? (
        <ul
          aria-label={t('channelInbox.v2.thread.suggestions')}
          className="flex flex-col items-end gap-1"
        >
          {suggestions.map((s, i) => (
            <li
              key={i}
              title={s.kind === 'link' ? s.url : undefined}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1 text-xs"
            >
              <span className="truncate">{s.kind === 'reply' ? s.text : s.title}</span>
              {s.kind === 'reply' ? (
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
