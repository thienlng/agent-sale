import type { AssistantSkillDto, AssistantSkillEventDto } from '@agent-sales/contracts';
import { ArrowLeft } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

import {
  useAssistantSkill,
  useAssistantSkillEvents,
  useDeleteShadow,
  useShadowSkill,
  useSkillAction,
  useUndoSkillEvent,
  useUpdateSkill,
} from '../api/assistant-skills';
import { useSkillErrorToast } from './skill-errors';

function formatTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

/** One ledger line: who changed what, when, and "Hoàn tác" while it can still be undone. */
function LedgerEntry({ event }: { event: AssistantSkillEventDto }) {
  const { t, i18n } = useTranslation('assistant');
  const undo = useUndoSkillEvent();
  const onError = useSkillErrorToast();
  const undoable = !event.undoneAt && event.action !== 'undo';
  return (
    <li className="flex items-center gap-2 py-1.5 text-xs">
      <span className="min-w-0 flex-1">
        <span className="font-medium">{t(`skills.actors.${event.actor}`)}</span>{' '}
        {t(`skills.actions.${event.action}`)}
        <span className="block text-muted-foreground">
          {formatTime(event.createdAt, i18n.language)}
        </span>
      </span>
      {event.undoneAt ? (
        <span className="shrink-0 text-muted-foreground">{t('skills.undone')}</span>
      ) : undoable ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={undo.isPending}
          onClick={() =>
            undo.mutate(event.id, {
              onSuccess: () => toast.success(t('skills.undoneToast')),
              onError,
            })
          }
        >
          {t('skills.undo')}
        </Button>
      ) : null}
    </li>
  );
}

function Ledger({ skillId }: { skillId: string }) {
  const { t } = useTranslation('assistant');
  const events = useAssistantSkillEvents(skillId);
  return (
    <section aria-label={t('skills.ledger')} className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold">{t('skills.ledger')}</h3>
      {events.isPending ? (
        <Skeleton className="h-10" />
      ) : events.isError ? (
        <p className="text-xs text-destructive">{t('loadError')}</p>
      ) : events.data.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('skills.ledgerEmpty')}</p>
      ) : (
        <ul className="divide-y">
          {events.data.map((event) => (
            <LedgerEntry key={event.id} event={event} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Description and body of an owner, learned or shadow skill; Lưu sends what changed. */
function SkillForm({ skill }: { skill: AssistantSkillDto }) {
  const { t } = useTranslation('assistant');
  const [description, setDescription] = useState(skill.description);
  const [body, setBody] = useState(skill.body);
  const update = useUpdateSkill();
  const onError = useSkillErrorToast();
  const descriptionId = useId();
  const bodyId = useId();
  const changes = {
    ...(description.trim() !== skill.description ? { description: description.trim() } : {}),
    ...(body.trim() !== skill.body.trim() ? { body: body.trim() } : {}),
  };
  const dirty = Object.keys(changes).length > 0;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!dirty || !skill.id) return;
        update.mutate(
          { skillId: skill.id, ...changes },
          { onSuccess: () => toast.success(t('skills.saved')), onError },
        );
      }}
    >
      <label htmlFor={descriptionId} className="text-xs font-medium">
        {t('skills.description')}
      </label>
      <Input
        id={descriptionId}
        value={description}
        maxLength={120}
        onChange={(event) => setDescription(event.target.value.replace(/[\r\n]/g, ' '))}
      />
      <label htmlFor={bodyId} className="text-xs font-medium">
        {t('skills.body')}
      </label>
      <Textarea
        id={bodyId}
        value={body}
        maxLength={8000}
        rows={10}
        className="font-mono text-xs"
        onChange={(event) => setBody(event.target.value)}
      />
      <Button type="submit" size="sm" className="self-end" disabled={!dirty || update.isPending}>
        {t('skills.save')}
      </Button>
    </form>
  );
}

/** The state actions that fit this skill: approve/drop, archive, restore, back to the original. */
function SkillActions({
  skill,
  onOpen,
}: {
  skill: AssistantSkillDto;
  onOpen: (ref: string) => void;
}) {
  const { t } = useTranslation('assistant');
  const action = useSkillAction();
  const shadow = useShadowSkill();
  const dropShadow = useDeleteShadow();
  const onError = useSkillErrorToast();
  const busy = action.isPending || shadow.isPending || dropShadow.isPending;
  const id = skill.id ?? '';
  const run = (a: 'approve' | 'reject' | 'archive' | 'restore') =>
    action.mutate({ skillId: id, action: a, expectedUpdatedAt: skill.updatedAt }, { onError });

  if (skill.provenance === 'platform')
    return (
      <Button
        size="sm"
        disabled={busy}
        onClick={() =>
          shadow.mutate(skill.name, {
            onSuccess: (created) => {
              toast.success(t('skills.shadowCreated'));
              onOpen(created.ref);
            },
            onError,
          })
        }
      >
        {t('skills.customise')}
      </Button>
    );
  if (skill.provenance === 'shadow')
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() =>
          dropShadow.mutate(id, {
            onSuccess: () => {
              toast.success(t('skills.originalRestored'));
              onOpen(`platform:${skill.shadowOf ?? skill.name}`);
            },
            onError,
          })
        }
      >
        {t('skills.restoreOriginal')}
      </Button>
    );
  if (skill.state === 'pending_approval')
    return (
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => run('approve')}>
          {t('skills.approve')}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run('reject')}>
          {t('skills.reject')}
        </Button>
      </div>
    );
  return (
    <div className="flex gap-2">
      {skill.state === 'archived' || skill.state === 'stale' ? (
        <Button size="sm" disabled={busy} onClick={() => run('restore')}>
          {t('skills.restore')}
        </Button>
      ) : null}
      {skill.state !== 'archived' ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run('archive')}>
          {t('skills.archive')}
        </Button>
      ) : null}
    </div>
  );
}

/** One skill: its text (editable unless it is a platform file), its actions and its ledger. */
export function AssistantSkillEditor({
  skillRef,
  onBack,
  onOpen,
}: {
  skillRef: string;
  onBack: () => void;
  onOpen: (ref: string) => void;
}) {
  const { t } = useTranslation('assistant');
  const skill = useAssistantSkill(skillRef);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft />
        {t('skills.back')}
      </Button>
      {skill.isPending ? (
        <Skeleton className="mt-3 h-40" />
      ) : skill.isError ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {t('loadError')}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          <div>
            <h2 className="font-semibold break-words">{skill.data.name}</h2>
            <p className="text-xs text-muted-foreground">
              {t(`skills.provenance.${skill.data.provenance}`)}
              {skill.data.state !== 'active' ? ` · ${t(`skills.states.${skill.data.state}`)}` : ''}
            </p>
          </div>
          {skill.data.provenance === 'platform' ? (
            <>
              <p className="text-sm">{skill.data.description}</p>
              <pre className="max-h-72 overflow-y-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
                {skill.data.body}
              </pre>
              <p className="text-xs text-muted-foreground">{t('skills.platformHint')}</p>
            </>
          ) : (
            // Keyed by the version: an undo or a save shows the server's text, not a stale draft.
            <SkillForm key={skill.data.updatedAt ?? skill.data.ref} skill={skill.data} />
          )}
          <SkillActions skill={skill.data} onOpen={onOpen} />
          {skill.data.id ? <Ledger skillId={skill.data.id} /> : null}
        </div>
      )}
    </div>
  );
}
