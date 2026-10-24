import type { BotSettings, ReplySchedule } from '@agent-sales/contracts';
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

import type { SettingsDraft, SettingsProblem } from '../utils/settings-draft';

type Update = (change: (draft: SettingsDraft) => SettingsDraft) => void;

/** Label on the left, control on the right (stacked on small screens). */
function SettingRow({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <Label htmlFor={id} className="font-semibold">
        {label}
      </Label>
      <div className="w-full sm:w-80">{children}</div>
    </div>
  );
}

function Choice<V extends string>({
  id,
  value,
  options,
  label,
  onChange,
}: {
  id: string;
  value: V;
  options: readonly V[];
  label: (value: V) => string;
  onChange: (value: V) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as V)}>
      <SelectTrigger id={id} className="h-10 w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {label(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** "Cài đặt cơ bản": identity (avatar, name, colour), language, model and reply hours. */
export function BotSettingsBasic({
  draft,
  problems,
  update,
}: {
  draft: SettingsDraft;
  problems: SettingsProblem[];
  update: Update;
}) {
  const { t } = useTranslation('training');
  const { settings } = draft;
  const set = <K extends keyof BotSettings>(key: K, value: BotSettings[K]) =>
    update((d) => ({ ...d, settings: { ...d.settings, [key]: value } }));
  const setSchedule = (change: Partial<ReplySchedule>) =>
    set('replySchedule', { ...settings.replySchedule, ...change });
  const validColour = !problems.includes('themeColor');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">{t('space.settings.avatar')}</span>
          <span
            aria-hidden
            className="grid size-10 place-items-center rounded-full bg-primary text-base font-semibold text-white"
            style={validColour ? { backgroundColor: settings.themeColor } : undefined}
          >
            {draft.name.trim().charAt(0).toUpperCase() || '?'}
          </span>
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-2">
          <Label htmlFor="setting-name" className="font-semibold">
            {t('space.settings.name')}
          </Label>
          <Input
            id="setting-name"
            className="h-10"
            maxLength={80}
            required
            aria-invalid={problems.includes('name')}
            value={draft.name}
            onChange={(e) => update((d) => ({ ...d, name: e.target.value }))}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="setting-themeColor" className="font-semibold">
            {t('space.settings.theme')}
          </Label>
          <div className="flex h-10 items-center gap-2 rounded-md border px-1.5">
            <input
              type="color"
              aria-label={t('space.settings.themePicker')}
              className="size-7 cursor-pointer rounded border-0 bg-transparent p-0"
              value={validColour ? settings.themeColor.toLowerCase() : '#000000'}
              onChange={(e) => set('themeColor', e.target.value.toUpperCase())}
            />
            <Input
              id="setting-themeColor"
              className="h-8 w-24 border-0 px-1 font-mono text-sm shadow-none focus-visible:ring-0"
              maxLength={7}
              aria-invalid={!validColour}
              aria-describedby={validColour ? undefined : 'setting-themeColor-error'}
              value={settings.themeColor}
              onChange={(e) => set('themeColor', e.target.value.trim())}
            />
          </div>
        </div>
      </div>
      {!validColour ? (
        <p id="setting-themeColor-error" role="alert" className="-mt-4 text-sm text-destructive">
          {t('space.settings.themeInvalid')}
        </p>
      ) : null}

      <SettingRow id="setting-language" label={t('space.settings.language')}>
        <Choice
          id="setting-language"
          value={settings.language}
          options={['vi', 'en'] as const}
          label={(v) => t(`space.settings.languageOptions.${v}`)}
          onChange={(v) => set('language', v)}
        />
      </SettingRow>
      <SettingRow id="setting-modelTier" label={t('space.settings.model')}>
        <Choice
          id="setting-modelTier"
          value={settings.modelTier}
          options={['basic', 'smart', 'pro', 'neo'] as const}
          label={(v) => t(`space.settings.modelOptions.${v}`)}
          onChange={(v) => set('modelTier', v)}
        />
      </SettingRow>
      <SettingRow id="setting-replySchedule" label={t('space.settings.schedule')}>
        <Choice
          id="setting-replySchedule"
          value={settings.replySchedule.mode}
          options={['always', 'custom'] as const}
          label={(v) => t(`space.settings.scheduleOptions.${v}`)}
          onChange={(mode) => setSchedule({ mode })}
        />
      </SettingRow>
      {settings.replySchedule.mode === 'custom' ? (
        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex w-full items-center gap-2 sm:w-80">
            <Input
              type="time"
              required
              className="h-10"
              aria-label={t('space.settings.scheduleStart')}
              aria-invalid={problems.includes('replySchedule')}
              value={settings.replySchedule.start}
              onChange={(e) => setSchedule({ start: e.target.value })}
            />
            <span aria-hidden className="text-muted-foreground">
              –
            </span>
            <Input
              type="time"
              required
              className="h-10"
              aria-label={t('space.settings.scheduleEnd')}
              aria-invalid={problems.includes('replySchedule')}
              value={settings.replySchedule.end}
              onChange={(e) => setSchedule({ end: e.target.value })}
            />
          </div>
          <p
            role={problems.includes('replySchedule') ? 'alert' : undefined}
            className={
              problems.includes('replySchedule')
                ? 'text-sm text-destructive'
                : 'text-sm text-muted-foreground'
            }
          >
            {problems.includes('replySchedule')
              ? t('space.settings.scheduleInvalid')
              : t('space.settings.scheduleHint')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
