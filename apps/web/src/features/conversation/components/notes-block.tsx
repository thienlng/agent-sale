import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';
import { useCan } from '@/lib/permissions';
import { useAddNote } from '../api/inbox';
import type { InboxConversation, InboxNote } from '../lib/inbox-v2-types';
import { PanelBlock } from './panel-block';

/** Notes the next shift needs: newest first, author and time, Enter adds a note. */
export function NotesBlock({ conversation: c }: { conversation: InboxConversation }) {
  const { t, i18n } = useTranslation();
  const tr = (key: string) => t(`channelInbox.v2.panel.${key}`);
  const canEdit = useCan('contacts.edit');
  const add = useAddNote(c.id);
  const [text, setText] = useState('');
  // The API lists oldest first. A legacy single note is kept visible until it is migrated.
  const notes: readonly InboxNote[] = [...c.notes].reverse();
  const legacy = c.notes.length === 0 && c.note.trim() ? c.note : null;
  const stamp = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  async function submit() {
    const body = text.trim();
    if (!body || add.isPending) return;
    try {
      await add.mutateAsync(body);
      setText('');
    } catch {
      toast.error(tr('noteError'));
    }
  }
  const count = c.notes.length + (legacy ? 1 : 0);
  return (
    <PanelBlock title={tr('notes')} summary={count ? String(count) : undefined}>
      {canEdit ? (
        <div className="relative mb-3">
          <Textarea
            aria-label={tr('notes')}
            placeholder={tr('noteAdd')}
            value={text}
            maxLength={2000}
            disabled={add.isPending}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
            className="min-h-16 resize-none text-sm"
          />
          {add.isPending ? (
            <Loader2 className="absolute right-2 bottom-2 size-4 animate-spin text-muted-foreground" />
          ) : null}
        </div>
      ) : null}
      {notes.length || legacy ? (
        <ol className="space-y-3">
          {notes.map((note) => (
            <li key={note.id} className="text-sm">
              <p className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate font-medium text-foreground">
                  {note.authorName?.trim() || tr('noteAuthor')}
                </span>
                <time dateTime={note.createdAt} className="shrink-0">
                  {stamp(note.createdAt)}
                </time>
              </p>
              <p className="break-words whitespace-pre-wrap">{note.text}</p>
            </li>
          ))}
          {legacy ? (
            <li className="text-sm">
              <p className="text-xs font-medium text-muted-foreground">{tr('legacyNote')}</p>
              <p className="break-words whitespace-pre-wrap">{legacy}</p>
            </li>
          ) : null}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">{tr('noteEmpty')}</p>
      )}
    </PanelBlock>
  );
}
