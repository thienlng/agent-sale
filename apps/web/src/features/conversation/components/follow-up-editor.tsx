import type { ConversationDto } from '@agent-sales/contracts';
import { Bell, Loader2 } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useSession } from '@/lib/session';
import { useInboxActions } from '../api/inbox';
import { draftKey } from '../lib/composer-draft';
import {
  followUpInputToIso,
  readFollowUpDraft,
  subscribeFollowUpDraft,
  toLocalFollowUpInput,
  writeFollowUpDraft,
} from '../lib/follow-up-draft';

/** A staff-only follow-up stored on the conversation; it does not schedule notifications. */
export function FollowUpEditor({ conversation: c }: { conversation: ConversationDto }) {
  const { t, i18n } = useTranslation();
  const tr = (key: string) => t(`channelInbox.sales.${key}`);
  const session = useSession();
  const scope = `${draftKey(session?.user.id ?? '', session?.workspaceId ?? '', c.id)}:follow-up`;
  const draft = useSyncExternalStore(
    (listener) => subscribeFollowUpDraft(scope, listener),
    () => readFollowUpDraft(scope),
  );
  const { update } = useInboxActions(c.id);
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const due = c.status === 'open' && Boolean(c.followUpAt && Date.parse(c.followUpAt) <= clock);
  const conflicted = draft !== null && draft.revision !== c.revision;
  async function save(clear = false) {
    if (update.isPending) return;
    const submitted = readFollowUpDraft(scope);
    const at = clear ? null : followUpInputToIso(submitted?.at ?? '');
    if (!clear && (!submitted || !at)) {
      toast.error(tr('followUpInvalid'));
      return;
    }
    try {
      await update.mutateAsync({
        followUpAt: at,
        followUpNote: clear ? '' : (submitted?.note.trim() ?? ''),
        expectedRevision: submitted?.revision ?? c.revision,
      });
      if (readFollowUpDraft(scope) === submitted) writeFollowUpDraft(scope, null);
      toast.success(tr(clear ? 'followUpCleared' : 'followUpSaved'));
    } catch {
      toast.error(tr('followUpSaveError'));
    }
  }
  return (
    <section className="space-y-3 rounded-xl border p-3" aria-label={tr('followUpTitle')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Bell className="size-4" />
          {tr('followUpTitle')}
        </h3>
        {due ? (
          <span className="rounded-full bg-warning-soft px-2 py-1 text-xs text-warning">
            {tr('followUpDue')}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{tr('followUpPrivate')}</p>
      {c.followUpAt ? (
        <div className="space-y-1 text-xs">
          <time dateTime={c.followUpAt}>
            {new Intl.DateTimeFormat(i18n.language, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(c.followUpAt))}
          </time>
          {c.followUpNote ? (
            <p className="whitespace-pre-wrap break-words">{c.followUpNote}</p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{tr('followUpEmpty')}</p>
      )}
      <p className="text-[11px] text-muted-foreground">
        {tr('followUpTimezone')}: {timezone}
      </p>
      {draft ? (
        <div className="space-y-2">
          <Label htmlFor={`follow-up-at-${c.id}`}>{tr('followUpAt')}</Label>
          <Input
            id={`follow-up-at-${c.id}`}
            type="datetime-local"
            value={draft.at}
            disabled={update.isPending}
            onChange={(event) => writeFollowUpDraft(scope, { ...draft, at: event.target.value })}
          />
          <Label htmlFor={`follow-up-note-${c.id}`}>{tr('followUpNote')}</Label>
          <Textarea
            id={`follow-up-note-${c.id}`}
            value={draft.note}
            maxLength={500}
            disabled={update.isPending}
            onChange={(event) => writeFollowUpDraft(scope, { ...draft, note: event.target.value })}
            className="min-h-16"
          />
          {conflicted ? (
            <div role="alert" className="space-y-2 text-xs text-warning">
              <p>{tr('followUpChanged')}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => writeFollowUpDraft(scope, { ...draft, revision: c.revision })}
              >
                {tr('followUpKeepDraft')}
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={update.isPending}
              onClick={() => writeFollowUpDraft(scope, null)}
            >
              {tr('followUpCancel')}
            </Button>
            <Button
              size="sm"
              disabled={update.isPending || !draft.at || conflicted}
              onClick={() => void save()}
            >
              {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {tr('followUpSave')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={update.isPending}
            onClick={() =>
              writeFollowUpDraft(scope, {
                at: toLocalFollowUpInput(c.followUpAt),
                note: c.followUpNote ?? '',
                revision: c.revision,
              })
            }
          >
            {tr(c.followUpAt ? 'followUpEdit' : 'followUpAdd')}
          </Button>
          {c.followUpAt ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={update.isPending}
              onClick={() => void save(true)}
            >
              {tr('followUpClear')}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}
