import { Loader2, StickyNote } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useInboxActions } from '../api/inbox';
import { readDraft, subscribeDraft, writeDraft } from '../lib/composer-draft';

/** Append a private note to a versioned snapshot; conflicts keep the operator's draft. */
export function InternalNoteComposer({
  id,
  scope,
  note,
  revision,
}: {
  id: string;
  scope: string;
  note: string;
  revision: number;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`channelInbox.sales.${key}`);
  const key = `${scope}:internal`;
  const existing = useSyncExternalStore(
    (listener) => subscribeDraft(key, listener),
    () => readDraft(key),
  );
  const draft = existing.text;
  const base = existing.noteBase ?? { note, revision };
  const { update } = useInboxActions(id);
  async function save() {
    if (!draft.trim() || update.isPending) return;
    const combined = [base.note, draft.trim()].filter(Boolean).join('\n\n');
    if (combined.length > 10000) {
      toast.error(tr('noteTooLong'));
      return;
    }
    try {
      await update.mutateAsync({ note: combined, expectedRevision: base.revision });
      if (readDraft(key).text === draft && readDraft(key).noteBase?.revision === base.revision)
        writeDraft(key, { text: '', attachment: null, attempt: null });
      toast.success(tr('noteSaved'));
    } catch {
      toast.error(tr('noteConflict'));
    }
  }
  return (
    <div className="rounded-xl border border-warning/30 bg-warning-soft/30 p-2">
      <p className="mb-2 flex items-center gap-2 px-2 text-xs font-medium">
        <StickyNote className="size-4" />
        {tr('internalNoteHint')}
      </p>
      <Textarea
        aria-label={tr('internalNote')}
        placeholder={tr('internalNotePlaceholder')}
        value={draft}
        maxLength={10000}
        disabled={update.isPending}
        className="min-h-20 border-0 bg-transparent shadow-none"
        onChange={(event) => {
          const text = event.target.value;
          writeDraft(key, { text, attachment: null, attempt: null, noteBase: base });
        }}
      />
      {base.revision !== revision && draft ? (
        <p role="alert" className="px-2 text-xs text-destructive">
          {tr('noteConflict')}
        </p>
      ) : null}
      <div className="mt-2 flex items-center justify-end gap-2">
        {base.revision !== revision && draft ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const next = { note, revision };
              writeDraft(key, { text: draft, attachment: null, attempt: null, noteBase: next });
            }}
          >
            {tr('refreshNoteBase')}
          </Button>
        ) : null}
        <Button
          size="sm"
          disabled={!draft.trim() || update.isPending || base.revision !== revision}
          onClick={() => void save()}
        >
          {update.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <StickyNote className="size-4" />
          )}
          {tr('saveInternalNote')}
        </Button>
      </div>
    </div>
  );
}
