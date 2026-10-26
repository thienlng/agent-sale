import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** Quick replies offered while the draft starts with "/", filtered by the text after it. */
export function SlashReplies<T extends { id: string; title: string; content: string }>({
  items,
  active,
  onPick,
}: {
  items: readonly T[];
  active: number;
  onPick: (item: T) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      id="slash-replies"
      role="listbox"
      aria-label={t('channelInbox.v2.slash.label')}
      className="absolute right-0 bottom-full left-0 z-10 mb-1 max-h-56 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md"
    >
      {items.length ? (
        items.map((item, index) => (
          <button
            type="button"
            role="option"
            aria-selected={index === active}
            key={item.id}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(item)}
            className={cn(
              'block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-muted',
              index === active && 'bg-muted',
            )}
          >
            <span className="block text-sm font-medium">{item.title}</span>
            <span className="line-clamp-1 block text-xs text-muted-foreground">{item.content}</span>
          </button>
        ))
      ) : (
        <p className="px-2.5 py-2 text-xs text-muted-foreground">
          {t('channelInbox.v2.slash.empty')}
        </p>
      )}
    </div>
  );
}
