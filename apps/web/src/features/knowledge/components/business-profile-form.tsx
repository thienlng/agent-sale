import {
  type BotDto,
  type ProfileFieldKey,
  PROFILE_NOTES_MAX,
  profileFieldsFor,
} from '@agent-sales/contracts';
import { useBlocker } from '@tanstack/react-router';
import { TriangleAlert } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/errors';
import { useCan } from '@/lib/permissions';

import { useBotProfile, useSaveBotProfile } from '../api/bot-profile';
import { DataError } from './data-page';

type Values = Partial<Record<ProfileFieldKey, string | undefined>>;
interface Draft {
  fields: Values;
  notes: string;
}

const draftOf = (bot: BotDto): Draft => ({
  fields: { ...bot.settings.profile.fields },
  notes: bot.settings.profile.notes,
});
const value = (values: Values, key: ProfileFieldKey) => (values[key] ?? '').trim();

/** Keeps what the member typed, takes the server's value for every field they did not touch. */
function rebase(draft: Draft, old: Draft, next: Draft, keys: ProfileFieldKey[]): Draft {
  const fields: Values = { ...draft.fields };
  for (const key of keys)
    if (value(draft.fields, key) === value(old.fields, key)) fields[key] = next.fields[key] ?? '';
  return { fields, notes: draft.notes.trim() === old.notes.trim() ? next.notes : draft.notes };
}

const isHttps = (url: string) => {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};

function ProfileForm({ bot }: { bot: BotDto }) {
  const { t } = useTranslation('training');
  const { t: common } = useTranslation();
  const canEdit = useCan('bots.manage');
  const save = useSaveBotProfile(bot.id);
  const defs = profileFieldsFor(bot.industry);
  const keys = defs.map((d) => d.key);
  const base = draftOf(bot);
  const [draft, setDraft] = useState<Draft>(base);

  const changed = keys.filter((k) => value(draft.fields, k) !== value(base.fields, k));
  const notesChanged = draft.notes.trim() !== base.notes.trim();
  const dirty = changed.length > 0 || notesChanged;
  const mapsInvalid =
    Boolean(value(draft.fields, 'mapsUrl')) && !isHttps(value(draft.fields, 'mapsUrl'));

  // Leaving with unsaved edits asks first: in-app navigation and closing the tab.
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });
  const shown = useRef(base);
  useEffect(() => {
    const old = shown.current;
    shown.current = draftOf(bot);
    setDraft((d) => rebase(d, old, shown.current, keys));
  }, [bot]);

  const filled = keys.filter((k) => value(draft.fields, k)).length;
  const setField = (key: ProfileFieldKey, next: string) =>
    setDraft({ ...draft, fields: { ...draft.fields, [key]: next } });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || !canEdit || mapsInvalid) return;
    const fields = Object.fromEntries(changed.map((k) => [k, value(draft.fields, k)]));
    save.mutate(
      {
        ...(changed.length ? { fields } : {}),
        ...(notesChanged ? { notes: draft.notes.trim() } : {}),
      },
      {
        onSuccess: () => toast.success(t('profile.saved')),
        onError: (err) => toast.error(errorMessage(common, err)),
      },
    );
  };

  const field = (def: (typeof defs)[number]) => {
    const text = draft.fields[def.key] ?? '';
    const id = `bp-${def.key}`;
    const inputProps = {
      id,
      maxLength: def.max,
      disabled: !canEdit,
      value: text,
      placeholder: t(`profile.examples.${def.key}`),
      onChange: (e: { target: { value: string } }) => setField(def.key, e.target.value),
    };
    const invalid = def.key === 'mapsUrl' && mapsInvalid;
    return (
      <div key={def.key} className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={id}>{t(`profile.fields.${def.key}`)}</Label>
          {text.trim() ? null : (
            <TriangleAlert
              role="img"
              aria-label={t('profile.missing')}
              className="size-3.5 text-warning"
            />
          )}
        </div>
        {def.max > 200 ? (
          <Textarea rows={2} {...inputProps} />
        ) : (
          <Input
            {...inputProps}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${id}-error` : undefined}
          />
        )}
        {invalid ? (
          <p id={`${id}-error`} className="text-xs text-destructive">
            {t('profile.invalidUrl')}
          </p>
        ) : null}
      </div>
    );
  };

  const group = (name: 'basic' | 'industry') => {
    const list = defs.filter((d) => d.group === name);
    if (!list.length) return null;
    return (
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-3 text-sm font-semibold">{t(`profile.groups.${name}`)}</legend>
        <div className="grid gap-4 md:grid-cols-2">{list.map(field)}</div>
      </fieldset>
    );
  };

  return (
    <form onSubmit={submit}>
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">{t('profile.title')}</CardTitle>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>{t('profile.template', { industry: common(`industries.${bot.industry}`) })}</span>
            <span className="font-medium text-foreground">
              {t('profile.completeness', { filled, total: keys.length })}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${keys.length ? (filled / keys.length) * 100 : 0}%` }}
            />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {!canEdit ? (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              {t('profile.readOnly')}
            </p>
          ) : null}
          {group('basic')}
          {group('industry')}
          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className="mb-3 text-sm font-semibold">{t('profile.groups.notes')}</legend>
            <Label htmlFor="bp-notes">{t('profile.notesLabel')}</Label>
            <Textarea
              id="bp-notes"
              rows={5}
              maxLength={PROFILE_NOTES_MAX}
              disabled={!canEdit}
              value={draft.notes}
              placeholder={t('profile.notesPlaceholder')}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
            <div className="flex justify-between gap-3 text-xs text-muted-foreground">
              <span>{t('profile.notesHint')}</span>
              <span className="shrink-0 tabular-nums">
                {t('profile.notesCounter', { used: draft.notes.length, max: PROFILE_NOTES_MAX })}
              </span>
            </div>
          </fieldset>
          {canEdit ? (
            <div className="flex flex-wrap items-center justify-end gap-3">
              {dirty ? (
                <span className="mr-auto text-sm text-warning" role="status">
                  {t('profile.dirty')}
                </span>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                disabled={!dirty}
                onClick={() => setDraft(base)}
              >
                {t('profile.reset')}
              </Button>
              <Button type="submit" disabled={!dirty || save.isPending || mapsInvalid}>
                {t('profile.save')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Dialog open={blocker.status === 'blocked'} onOpenChange={(o) => !o && blocker.reset?.()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('profile.dirty')}</DialogTitle>
            <DialogDescription>{t('profile.leave')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => blocker.reset?.()}>
              {t('profile.stay')}
            </Button>
            <Button variant="destructive" onClick={() => blocker.proceed?.()}>
              {t('profile.leaveConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

/** Structured business facts of one bot (what it may say), the template and free notes. */
export function BusinessProfileForm({ botId }: { botId: string }) {
  const bot = useBotProfile(botId);
  if (bot.data) return <ProfileForm key={bot.data.id} bot={bot.data} />;
  if (bot.isError) return <DataError onRetry={() => void bot.refetch()} />;
  return <Skeleton className="h-96 rounded-xl" />;
}
