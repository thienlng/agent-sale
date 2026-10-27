import { MessageSquareText } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { useQuickReplies } from '../api/inbox';

/** The bot's saved replies; picking one inserts it at the caret, it is never sent by itself. */
export function QuickRepliesMenu({
  quick,
  disabled,
  onPick,
}: {
  quick: ReturnType<typeof useQuickReplies>;
  disabled: boolean;
  onPick: (content: string) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`channelInbox.${key}`);
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={tr('quickReplies')}
          title={tr('quickReplies')}
        >
          <MessageSquareText />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-72 overflow-y-auto p-2">
        {quick.isPending ? (
          <p className="p-3 text-xs text-muted-foreground">{tr('loading')}</p>
        ) : quick.isError ? (
          <p role="alert" className="p-3 text-xs text-destructive">
            {tr('loadError')}
          </p>
        ) : quick.data?.length ? (
          quick.data.map((item) => (
            <button
              type="button"
              key={item.id}
              className="block w-full rounded-lg p-3 text-left hover:bg-muted"
              onClick={() => {
                onPick(item.content);
                setOpen(false);
              }}
            >
              <span className="block text-sm font-medium">{item.title}</span>
              <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">
                {item.content}
              </span>
            </button>
          ))
        ) : (
          <p className="p-3 text-xs text-muted-foreground">{tr('noQuickReplies')}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
