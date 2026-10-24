import type { BotDto, BotSettings } from '@agent-sales/contracts';
import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/errors';

import { useReadiness, useUpdateBot } from '../api/bots';
import { placeholderLabel } from '@/lib/placeholders';

type TextKey =
  'mission' | 'greeting' | 'selfPronoun' | 'customerPronoun' | 'fallbackMessage' | 'handoffMessage';
type Draft = { name: string; settings: BotSettings };

function Row({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Store details first (they unblock template answers), then how the bot
 * talks. Only changed fields are sent; the save bar appears when dirty.
 */
export function BotSettingsForm({ bot }: { bot: BotDto }) {
  const { t } = useTranslation();
  const { t: training } = useTranslation('training');
  const update = useUpdateBot(bot.id);
  const readiness = useReadiness(bot.id);
  const initial: Draft = useMemo(() => ({ name: bot.name, settings: bot.settings }), [bot]);
  const [draft, setDraft] = useState<Draft>(initial);

  const placeholderKeys = useMemo(
    () =>
      [
        ...new Set([
          ...(readiness.data?.missingPlaceholders ?? []),
          ...Object.keys(bot.settings.placeholders),
        ]),
      ].sort((a, b) => a.localeCompare(b)),
    [readiness.data, bot.settings.placeholders],
  );

  const changed = useMemo(() => {
    const settings: Partial<BotSettings> = {};
    for (const key of Object.keys(draft.settings) as Array<keyof BotSettings>) {
      if (JSON.stringify(draft.settings[key]) !== JSON.stringify(initial.settings[key])) {
        Object.assign(settings, { [key]: draft.settings[key] });
      }
    }
    return {
      ...(draft.name !== initial.name ? { name: draft.name } : {}),
      ...(Object.keys(settings).length ? { settings } : {}),
    };
  }, [draft, initial]);
  const dirty = Object.keys(changed).length > 0;

  const setText = (key: TextKey, value: string) =>
    setDraft((d) => ({ ...d, settings: { ...d.settings, [key]: value } }));
  const setPlaceholder = (key: string, value: string) =>
    setDraft((d) => ({
      ...d,
      settings: { ...d.settings, placeholders: { ...d.settings.placeholders, [key]: value } },
    }));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    update.mutate(changed, {
      onSuccess: (saved) => {
        setDraft({ name: saved.name, settings: saved.settings });
        toast.success(t('settings.saved'));
      },
      onError: (err) => toast.error(errorMessage(t, err)),
    });
  }

  const text = (key: TextKey, opts: { multiline?: boolean; hint?: string } = {}) => {
    const id = `setting-${key}`;
    const props = {
      id,
      value: draft.settings[key],
      onChange: (e: { target: { value: string } }) => setText(key, e.target.value),
      ...(opts.hint ? { 'aria-describedby': `${id}-hint` } : {}),
    };
    return (
      <Row id={id} label={t(`settings.${key}`)} {...(opts.hint ? { hint: opts.hint } : {})}>
        {opts.multiline ? <Textarea rows={3} {...props} /> : <Input className="h-10" {...props} />}
      </Row>
    );
  };

  const choice = <K extends 'creativity' | 'modelTier' | 'language'>(
    key: K,
    options: readonly BotSettings[K][],
  ) => (
    <Row id={`setting-${key}`} label={t(`settings.${key}`)}>
      <Select
        value={draft.settings[key]}
        onValueChange={(v) => setDraft((d) => ({ ...d, settings: { ...d.settings, [key]: v } }))}
      >
        <SelectTrigger id={`setting-${key}`} className="h-10 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {t(`settings.${key}Options.${o}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  );

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-2xl flex-col gap-10 pb-24">
      {placeholderKeys.length ? (
        <section>
          <h2 className="text-lg font-semibold">{t('settings.storeInfo')}</h2>
          <p className="mt-1 text-muted-foreground">{t('settings.storeInfoHint')}</p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            {placeholderKeys.map((key) => {
              const id = `placeholder-${key}`;
              const empty = !draft.settings.placeholders[key]?.trim();
              return (
                <Row key={key} id={id} label={placeholderLabel(t, key)}>
                  <Input
                    id={id}
                    className="h-10 data-[empty=true]:border-warning/60 data-[empty=true]:bg-warning-soft/40"
                    data-empty={empty}
                    value={draft.settings.placeholders[key] ?? ''}
                    onChange={(e) => setPlaceholder(key, e.target.value)}
                  />
                </Row>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-5">
        <h2 className="text-lg font-semibold">{t('settings.behaviour')}</h2>
        <Row id="setting-name" label={t('settings.name')}>
          <Input
            id="setting-name"
            className="h-10"
            maxLength={80}
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </Row>
        {text('mission', { multiline: true, hint: t('settings.missionHint') })}
        {text('greeting', { multiline: true })}
        <div className="grid gap-5 sm:grid-cols-2">
          {text('selfPronoun')}
          {text('customerPronoun')}
        </div>
        {text('fallbackMessage', { multiline: true, hint: t('settings.fallbackHint') })}
        {text('handoffMessage', { multiline: true })}
        <div className="grid gap-5 sm:grid-cols-3">
          {choice('creativity', ['strict', 'balanced', 'creative'])}
          {choice('modelTier', ['basic', 'smart', 'pro', 'neo'])}
          {choice('language', ['vi', 'en'])}
        </div>
      </section>

      <section className="space-y-5">
        <h2 className="text-lg font-semibold">{training('handoverTitle')}</h2>
        {(['autoResumeAfterManual', 'silenceOnExternalReply'] as const).map((key) => (
          <div key={key} className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor={`setting-${key}`}>{training(key)}</Label>
              <p className="text-sm text-muted-foreground">
                {training(key === 'autoResumeAfterManual' ? 'autoResumeHint' : 'silenceHint')}
              </p>
            </div>
            <Switch
              id={`setting-${key}`}
              checked={draft.settings[key]}
              onCheckedChange={(value) =>
                setDraft((state) => ({ ...state, settings: { ...state.settings, [key]: value } }))
              }
            />
          </div>
        ))}
        <Row id="setting-humanTakeoverMinutes" label={training('humanTakeoverMinutes')}>
          <Input
            id="setting-humanTakeoverMinutes"
            type="number"
            min={1}
            max={1440}
            required
            value={draft.settings.humanTakeoverMinutes}
            onChange={(event) =>
              setDraft((state) => ({
                ...state,
                settings: { ...state.settings, humanTakeoverMinutes: Number(event.target.value) },
              }))
            }
          />
        </Row>
      </section>

      {dirty ? (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-4 rounded-xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur animate-in fade-in slide-in-from-bottom-2">
          <span className="text-sm text-muted-foreground">{t('settings.unsaved')}</span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setDraft(initial)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? t('settings.saving') : t('settings.save')}
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
