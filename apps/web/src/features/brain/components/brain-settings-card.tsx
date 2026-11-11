import { BRAIN_IDLE_MINUTES, type BrainSettingsDto } from '@agent-sales/contracts';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useCan } from '@/lib/permissions';

import { useBrainSettings, useBrainUsage, useSaveBrainSettings } from '../api/brain';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * Business Brain settings (spec §5): today's evaluations, when conversations are evaluated
 * (automatically once quiet, or only on click), the quiet time and the morning briefing.
 * Owners and admins change them; everyone else reads.
 */
export function BrainSettingsCard() {
  const { t } = useTranslation('brain');
  const settings = useBrainSettings();
  const usage = useBrainUsage();
  return (
    <section
      aria-labelledby="brain-settings-title"
      className="flex max-w-2xl flex-col gap-5 rounded-xl border bg-card p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="brain-settings-title" className="text-base font-semibold">
          {t('settings.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('settings.description')}</p>
        {usage.data ? (
          <p className="mt-1 text-sm font-medium tabular-nums">
            {usage.data.limit === null
              ? t('settings.usageUnlimited', { used: usage.data.used })
              : t('settings.usage', { used: usage.data.used, limit: usage.data.limit })}
          </p>
        ) : null}
      </div>
      {settings.data ? (
        <SettingsForm initial={settings.data} />
      ) : (
        <Skeleton className="h-48 rounded-lg" />
      )}
    </section>
  );
}

function SettingsForm({ initial }: { initial: BrainSettingsDto }) {
  const { t } = useTranslation('brain');
  const canEdit = useCan('settings.manage');
  const save = useSaveBrainSettings();
  const [form, setForm] = useState(initial);
  const [idle, setIdle] = useState(String(initial.idleMinutes));
  const idleValue = Number(idle);
  const idleValid =
    Number.isInteger(idleValue) &&
    idleValue >= BRAIN_IDLE_MINUTES.min &&
    idleValue <= BRAIN_IDLE_MINUTES.max;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!idleValid) return;
    save.mutate(
      { ...form, idleMinutes: idleValue },
      {
        onSuccess: () => toast.success(t('settings.saved')),
        onError: () => toast.error(t('settings.error')),
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <fieldset disabled={!canEdit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label id="brain-mode-label">{t('settings.mode')}</Label>
          <RadioGroup
            aria-labelledby="brain-mode-label"
            value={form.mode}
            onValueChange={(v) => setForm({ ...form, mode: v as BrainSettingsDto['mode'] })}
            className="gap-2"
          >
            {(['auto', 'manual'] as const).map((mode) => (
              <div key={mode} className="flex items-center gap-2">
                <RadioGroupItem id={`brain-mode-${mode}`} value={mode} />
                <Label htmlFor={`brain-mode-${mode}`} className="font-normal">
                  {t(`settings.${mode}`)}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="brain-idle">{t('settings.idle')}</Label>
          <Input
            id="brain-idle"
            type="number"
            inputMode="numeric"
            min={BRAIN_IDLE_MINUTES.min}
            max={BRAIN_IDLE_MINUTES.max}
            value={idle}
            aria-invalid={!idleValid}
            aria-describedby="brain-idle-hint"
            className="w-32"
            disabled={!canEdit || form.mode === 'manual'}
            onChange={(e) => setIdle(e.target.value)}
          />
          <p id="brain-idle-hint" className="text-xs text-muted-foreground">
            {t('settings.idleHint')}
          </p>
        </div>
        <div className="flex flex-col gap-3 border-t pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <Label htmlFor="brain-briefing">{t('settings.briefing')}</Label>
              <p className="text-xs text-muted-foreground">{t('settings.briefingHint')}</p>
            </div>
            <Switch
              id="brain-briefing"
              checked={form.briefingEnabled}
              onCheckedChange={(on) => setForm({ ...form, briefingEnabled: on })}
            />
          </div>
          <div className="flex items-center gap-3">
            <Label htmlFor="brain-briefing-hour" className="font-normal">
              {t('settings.briefingHour')}
            </Label>
            <Select
              value={String(form.briefingHour)}
              onValueChange={(v) => setForm({ ...form, briefingHour: Number(v) })}
              disabled={!canEdit || !form.briefingEnabled}
            >
              <SelectTrigger id="brain-briefing-hour" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOURS.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {`${String(h).padStart(2, '0')}:00`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </fieldset>
      {canEdit ? (
        <div>
          <Button type="submit" disabled={save.isPending || !idleValid}>
            {t('settings.save')}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('settings.readOnly')}</p>
      )}
    </form>
  );
}
