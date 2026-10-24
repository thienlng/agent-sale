import type { BotSettings } from '@agent-sales/contracts';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { placeholderLabel } from '@/lib/placeholders';

import type { SettingsDraft } from '../utils/settings-draft';

type TextKey =
  'mission' | 'greeting' | 'selfPronoun' | 'customerPronoun' | 'fallbackMessage' | 'handoffMessage';
type Update = (change: (draft: SettingsDraft) => SettingsDraft) => void;

function Field({
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
 * "Cài đặt nâng cao": store details (they unblock template answers), how the
 * bot talks and when it hands over to staff.
 */
export function BotSettingsAdvanced({
  draft,
  placeholderKeys,
  update,
}: {
  draft: SettingsDraft;
  placeholderKeys: string[];
  update: Update;
}) {
  const { t } = useTranslation();
  const { t: training } = useTranslation('training');
  const set = <K extends keyof BotSettings>(key: K, value: BotSettings[K]) =>
    update((d) => ({ ...d, settings: { ...d.settings, [key]: value } }));

  const text = (key: TextKey, opts: { multiline?: boolean; hint?: string } = {}) => {
    const id = `setting-${key}`;
    const props = {
      id,
      value: draft.settings[key],
      onChange: (e: { target: { value: string } }) => set(key, e.target.value),
      ...(opts.hint ? { 'aria-describedby': `${id}-hint` } : {}),
    };
    return (
      <Field id={id} label={t(`settings.${key}`)} {...(opts.hint ? { hint: opts.hint } : {})}>
        {opts.multiline ? <Textarea rows={3} {...props} /> : <Input className="h-10" {...props} />}
      </Field>
    );
  };

  return (
    <div className="flex flex-col gap-10">
      {placeholderKeys.length ? (
        <section>
          <h2 className="text-base font-semibold">{t('settings.storeInfo')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('settings.storeInfoHint')}</p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            {placeholderKeys.map((key) => {
              const id = `placeholder-${key}`;
              const empty = !draft.settings.placeholders[key]?.trim();
              return (
                <Field key={key} id={id} label={placeholderLabel(t, key)}>
                  <Input
                    id={id}
                    className="h-10 data-[empty=true]:border-warning/60 data-[empty=true]:bg-warning-soft/40"
                    data-empty={empty}
                    value={draft.settings.placeholders[key] ?? ''}
                    onChange={(e) =>
                      set('placeholders', { ...draft.settings.placeholders, [key]: e.target.value })
                    }
                  />
                </Field>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-5">
        <h2 className="text-base font-semibold">{t('settings.behaviour')}</h2>
        {text('mission', { multiline: true, hint: t('settings.missionHint') })}
        {text('greeting', { multiline: true })}
        <div className="grid gap-5 sm:grid-cols-2">
          {text('selfPronoun')}
          {text('customerPronoun')}
        </div>
        {text('fallbackMessage', { multiline: true, hint: t('settings.fallbackHint') })}
        {text('handoffMessage', { multiline: true })}
        <Field id="setting-creativity" label={t('settings.creativity')}>
          <Select
            value={draft.settings.creativity}
            onValueChange={(v) => set('creativity', v as BotSettings['creativity'])}
          >
            <SelectTrigger id="setting-creativity" className="h-10 w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['strict', 'balanced', 'creative'] as const).map((o) => (
                <SelectItem key={o} value={o}>
                  {t(`settings.creativityOptions.${o}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </section>

      <section className="flex flex-col gap-5">
        <h2 className="text-base font-semibold">{training('handoverTitle')}</h2>
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
              onCheckedChange={(value) => set(key, value)}
            />
          </div>
        ))}
        <Field id="setting-humanTakeoverMinutes" label={training('humanTakeoverMinutes')}>
          <Input
            id="setting-humanTakeoverMinutes"
            type="number"
            min={1}
            max={1440}
            required
            className="h-10 sm:w-40"
            value={draft.settings.humanTakeoverMinutes}
            onChange={(e) => set('humanTakeoverMinutes', Number(e.target.value))}
          />
        </Field>
      </section>
    </div>
  );
}
