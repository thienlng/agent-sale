import { BookmarkPlus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MAX_SAVED_INBOX_VIEWS, useSavedInboxViews } from '../hooks/use-saved-inbox-views';
import type { ListState } from '../lib/inbox-list';

export function SavedInboxViews({
  workspaceId,
  userId,
  state,
  onApply,
}: {
  workspaceId: string;
  userId: string;
  state: ListState;
  onApply: (patch: Partial<ListState>) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.sales.views.${key}`, options ?? {});
  const saved = useSavedInboxViews(workspaceId, userId);
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={tr('title')} title={tr('title')}>
          <BookmarkPlus />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        <p className="text-xs text-muted-foreground">{tr('deviceHint')}</p>
        {saved.error ? (
          <p role="alert" className="text-xs text-destructive">
            {tr('storageError')}
          </p>
        ) : null}
        {saved.views.length ? (
          <ul className="space-y-1">
            {saved.views.map((view) => (
              <li key={view.id} className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-w-0 flex-1 justify-start"
                  onClick={() => {
                    onApply({ ...view.filters, q: '' });
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{view.name}</span>
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={tr('delete', { name: view.name })}
                  onClick={() => saved.remove(view.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">{tr('empty')}</p>
        )}
        <form
          className="space-y-2 border-t pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (saved.save(name.trim(), state)) setName('');
          }}
        >
          <Input
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            aria-label={tr('name')}
            placeholder={tr('name')}
          />
          <Button
            type="submit"
            size="sm"
            className="w-full"
            disabled={!name.trim() || !userId || saved.views.length >= MAX_SAVED_INBOX_VIEWS}
          >
            {tr('save')}
          </Button>
          {saved.views.length >= MAX_SAVED_INBOX_VIEWS ? (
            <p className="text-xs text-muted-foreground">{tr('limit')}</p>
          ) : null}
        </form>
      </PopoverContent>
    </Popover>
  );
}
