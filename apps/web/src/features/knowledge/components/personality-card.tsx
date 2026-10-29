import type { BotDto, BotSettings } from '@agent-sales/contracts';
import { useBlocker } from '@tanstack/react-router';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/errors';
import { useCan } from '@/lib/permissions';

import { useBotProfile, useSaveBotSettings } from '../api/bot-profile';
import { DataError } from './data-page';

const KEYS = [
  'mission',
  'selfPronoun',
  'customerPronoun',
  'replyLength',
  'tone',
  'allowEmoji',
  'greeting',
] as const;
type Key = (typeof KEYS)[number];
type Draft = Pick<BotSettings, Key>;

const SELF_PRONOUNS = ['em', 'mình', 'shop'];
const CUSTOMER_PRONOUNS = ['anh/chị', 'bạn', 'quý khách'];
const LENGTHS = ['veryShort', 'short', 'detailed'] as const;
const TONES = ['friendly', 'formal'] as const;

const draftOf = (bot: BotDto): Draft => ({
  mission: bot.settings.mission,
  selfPronoun: bot.settings.selfPronoun,
  customerPronoun: bot.settings.customerPronoun,
  replyLength: bot.settings.replyLength,
  tone: bot.settings.tone,
  allowEmoji: bot.settings.allowEmoji,
  greeting: bot.settings.greeting,
});

/** Keeps what the member typed, takes the server's value for every key they did not touch. */
function rebase(draft: Draft, old: Draft, next: Draft): Draft {
  const out: Record<Key, unknown> = { ...draft };
  for (const key of KEYS) if (draft[key] === old[key]) out[key] = next[key];
  return out as Draft;
}

function PronounField({
  id,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: string[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        list={`${id}-options`}
        maxLength={20}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={`${id}-options`}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </div>
  );
}

function Form({ bot }: { bot: BotDto }) {
  const { t } = useTranslation('training');
  const { t: common } = useTranslation();
  const canEdit = useCan('bots.manage');
  const save = useSaveBotSettings(bot.id);
  const base = draftOf(bot);
  const [draft, setDraft] = useState<Draft>(base);
  const changed = KEYS.filter((k) => draft[k] !== base[k]);
  const dirty = changed.length > 0;

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
    setDraft((d) => rebase(d, old, shown.current));
  }, [bot]);

  const set = <K extends Key>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || !canEdit) return;
    save.mutate(Object.fromEntries(changed.map((k) => [k, draft[k]])), {
      onSuccess: () => toast.success(t('personality.saved')),
      onError: (err) => toast.error(errorMessage(common, err)),
    });
  };

  return (
    <form onSubmit={submit}>
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">{t('personality.title')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('personality.subtitle')}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {!canEdit ? (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              {t('personality.readOnly')}
            </p>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="personality-mission">{t('personality.mission')}</Label>
            <Textarea
              id="personality-mission"
              rows={4}
              maxLength={4000}
              disabled={!canEdit}
              value={draft.mission}
              onChange={(e) => set('mission', e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('personality.missionHint')}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <PronounField
              id="personality-self"
              label={t('personality.selfPronoun')}
              value={draft.selfPronoun}
              options={SELF_PRONOUNS}
              disabled={!canEdit}
              onChange={(v) => set('selfPronoun', v)}
            />
            <PronounField
              id="personality-customer"
              label={t('personality.customerPronoun')}
              value={draft.customerPronoun}
              options={CUSTOMER_PRONOUNS}
              disabled={!canEdit}
              onChange={(v) => set('customerPronoun', v)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">{t('personality.replyLength')}</legend>
              <RadioGroup
                value={draft.replyLength}
                disabled={!canEdit}
                onValueChange={(v) => set('replyLength', v as Draft['replyLength'])}
              >
                {LENGTHS.map((o) => (
                  <div key={o} className="flex items-center gap-2">
                    <RadioGroupItem value={o} id={`personality-length-${o}`} />
                    <Label htmlFor={`personality-length-${o}`} className="font-normal">
                      {t(`personality.replyLengthOptions.${o}`)}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>
            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">{t('personality.tone')}</legend>
              <RadioGroup
                value={draft.tone}
                disabled={!canEdit}
                onValueChange={(v) => set('tone', v as Draft['tone'])}
              >
                {TONES.map((o) => (
                  <div key={o} className="flex items-center gap-2">
                    <RadioGroupItem value={o} id={`personality-tone-${o}`} />
                    <Label htmlFor={`personality-tone-${o}`} className="font-normal">
                      {t(`personality.toneOptions.${o}`)}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-1">
              <Label htmlFor="personality-emoji">{t('personality.allowEmoji')}</Label>
              <p className="text-xs text-muted-foreground">{t('personality.allowEmojiHint')}</p>
            </div>
            <Switch
              id="personality-emoji"
              checked={draft.allowEmoji}
              disabled={!canEdit}
              onCheckedChange={(v) => set('allowEmoji', v)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="personality-greeting">{t('personality.greeting')}</Label>
            <Textarea
              id="personality-greeting"
              rows={3}
              maxLength={1000}
              disabled={!canEdit}
              value={draft.greeting}
              onChange={(e) => set('greeting', e.target.value)}
            />
          </div>
          {canEdit ? (
            <div className="flex flex-wrap items-center justify-end gap-3">
              {dirty ? (
                <span className="mr-auto text-sm text-warning" role="status">
                  {t('personality.dirty')}
                </span>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                disabled={!dirty}
                onClick={() => setDraft(base)}
              >
                {t('personality.reset')}
              </Button>
              <Button type="submit" disabled={!dirty || save.isPending}>
                {t('personality.save')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Dialog open={blocker.status === 'blocked'} onOpenChange={(o) => !o && blocker.reset?.()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('personality.dirty')}</DialogTitle>
            <DialogDescription>{t('personality.leave')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => blocker.reset?.()}>
              {t('personality.stay')}
            </Button>
            <Button variant="destructive" onClick={() => blocker.proceed?.()}>
              {t('personality.leaveConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

/** How the bot talks: mission, pronouns, reply length, tone, emoji and greeting in one form. */
export function PersonalityCard({ botId }: { botId: string }) {
  const bot = useBotProfile(botId);
  if (bot.data) return <Form key={bot.data.id} bot={bot.data} />;
  if (bot.isError) return <DataError onRetry={() => void bot.refetch()} />;
  return <Skeleton className="h-96 rounded-xl" />;
}
