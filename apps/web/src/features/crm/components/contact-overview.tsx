import type { ContactDto } from '@agent-sales/contracts';
import { Pencil, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatDateTime } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

import { useAddNote, useDeleteNote, useEditNote, useNotes, useUpdateContact } from '../api/crm';
import { crmErrorMessage } from '../hooks/crm-errors';
import type { CrmLookups } from '../hooks/use-crm-lookups';

/** The pipeline as clickable steps; the current status is filled. */
function PipelineStrip({ contact, lookups }: { contact: ContactDto; lookups: CrmLookups }) {
  const { t } = useTranslation();
  const update = useUpdateContact(contact.id);
  const readOnly = !useCan('contacts.edit');
  const steps = lookups.statuses.filter((s) => !s.archived || s.id === contact.statusId);
  const current = steps.findIndex((s) => s.id === contact.statusId);
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium">{t('crm.detail.pipeline')}</h3>
      <ol className="flex flex-wrap gap-1.5" aria-label={t('crm.detail.pipeline')}>
        {steps.map((s, i) => {
          const on = s.id === contact.statusId;
          return (
            <li key={s.id}>
              <button
                type="button"
                aria-pressed={on}
                disabled={readOnly || update.isPending || on}
                onClick={() =>
                  update.mutate(
                    { statusId: s.id, expectedVersion: contact.version },
                    {
                      onSuccess: () =>
                        toast.success(t('crm.detail.statusChanged', { status: s.name })),
                      onError: (err) => toast.error(crmErrorMessage(t, err)),
                    },
                  )
                }
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-offset-3 focus-visible:ring-offset-background focus-visible:ring-ring focus-visible:outline-none',
                  on
                    ? 'font-semibold text-foreground'
                    : i < current
                      ? 'text-foreground hover:bg-muted'
                      : 'text-muted-foreground hover:bg-muted',
                )}
                style={on ? { borderColor: s.color, backgroundColor: `${s.color}26` } : undefined}
              >
                {s.name}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function NoteItem({
  contactId,
  note,
}: {
  contactId: string;
  note: {
    id: string;
    body: string;
    authorUserId: string | null;
    authorName: string | null;
    createdAt: string;
    editedAt: string | null;
    version: number;
  };
}) {
  const { t } = useTranslation();
  const edit = useEditNote(contactId);
  const remove = useDeleteNote(contactId);
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const canEdit = useCan('contacts.edit');
  // Same rule as the server: the author, or a member who sees every customer (owner, admin).
  const me = useSession()?.user.id;
  const seesAll = useCan('contacts.view_all');
  const canDelete = canEdit && (seesAll || (me !== undefined && note.authorUserId === me));
  return (
    <li className="rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">{note.authorName ?? '—'}</span> ·{' '}
          <span className="tabular-nums">{formatDateTime(note.createdAt)}</span>
          {note.editedAt ? ` · ${t('crm.detail.edited')}` : ''}
        </span>
        {draft === null && canEdit ? (
          <span className="flex items-center">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('crm.detail.editNote')}
              onClick={() => setDraft(note.body)}
            >
              <Pencil />
            </Button>
            {canDelete ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('crm.detail.deleteNote')}
                onClick={() => setConfirming(true)}
              >
                <Trash2 />
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>
      <AlertDialog open={confirming} onOpenChange={(o) => !remove.isPending && setConfirming(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('crm.detail.deleteNoteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('crm.detail.deleteNoteBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              {t('crm.detail.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                remove.mutate(note.id, {
                  onSuccess: () => {
                    setConfirming(false);
                    toast.success(t('crm.detail.noteDeleted'));
                  },
                  onError: (err) => toast.error(crmErrorMessage(t, err)),
                });
              }}
            >
              {t('crm.detail.confirmDeleteNote')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {draft === null ? (
        <p className="mt-1 text-sm whitespace-pre-line">{note.body}</p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <Textarea
            rows={3}
            maxLength={5000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={t('crm.detail.editNote')}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
              {t('crm.detail.cancel')}
            </Button>
            <Button
              size="sm"
              disabled={edit.isPending || !draft.trim()}
              onClick={() =>
                edit.mutate(
                  { noteId: note.id, body: draft.trim(), expectedVersion: note.version },
                  {
                    onSuccess: () => setDraft(null),
                    onError: (err) => toast.error(crmErrorMessage(t, err)),
                  },
                )
              }
            >
              {t('crm.detail.saveNote')}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Pipeline, internal notes timeline and the task summary (tasks arrive with CRM-05). */
export function ContactOverviewTab({
  contact,
  lookups,
}: {
  contact: ContactDto;
  lookups: CrmLookups;
}) {
  const { t } = useTranslation();
  const notes = useNotes(contact.id);
  const add = useAddNote(contact.id);
  const [body, setBody] = useState('');
  const readOnly = !useCan('contacts.edit');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    add.mutate(body.trim(), {
      onSuccess: () => {
        setBody('');
        toast.success(t('crm.detail.noteAdded'));
      },
      onError: (err) => toast.error(crmErrorMessage(t, err)),
    });
  };
  return (
    <div className="flex flex-col gap-5">
      <PipelineStrip contact={contact} lookups={lookups} />
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t('crm.detail.notes')}</h3>
        <form onSubmit={submit} className={readOnly ? 'hidden' : 'flex flex-col gap-2'}>
          <Textarea
            rows={3}
            maxLength={5000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('crm.detail.notePlaceholder')}
            aria-label={t('crm.detail.notes')}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={add.isPending || !body.trim()}>
              {t('crm.detail.addNote')}
            </Button>
          </div>
        </form>
        {notes.data?.length ? (
          <ul className="flex flex-col gap-2">
            {notes.data.map((n) => (
              <NoteItem key={`${n.id}:${n.version}`} contactId={contact.id} note={n} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('crm.detail.noNotes')}</p>
        )}
      </section>
    </div>
  );
}
