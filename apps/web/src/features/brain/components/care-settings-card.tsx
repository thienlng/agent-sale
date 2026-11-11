import {
  CARE_AFTER_SALE_DAYS,
  type AutonomyActionDto,
  type AutonomyLevel,
  type CareSettingsResponse,
  type CareTemplateDto,
} from '@agent-sales/contracts';
import { Info } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useCan } from '@/lib/permissions';

import {
  useAutonomy,
  useCareSettings,
  useSaveCareSettings,
  type CareSettingsChange,
} from '../api/care';

const INSTRUCTION_MAX = 500;
const hour = (h: number) => `${String(h).padStart(2, '0')}:00`;

/**
 * "Chăm sóc tự động" (spec 2026-11-11 care §3–§5): the follow-up templates (on/off and the
 * owner's instruction), how far the AI may go on its own, the fixed quiet hours, the daily cap
 * with today's usage, and Meta's 24-hour rule in plain words. `settings.manage` changes it.
 */
export function CareSettingsCard() {
  const { t } = useTranslation('brain');
  const settings = useCareSettings();
  const autonomy = useAutonomy();
  const usage = settings.data?.usage;
  return (
    <section
      aria-labelledby="care-settings-title"
      className="flex max-w-2xl flex-col gap-5 rounded-xl border bg-card p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="care-settings-title" className="text-base font-semibold">
          {t('careSettings.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('careSettings.description')}</p>
        {usage ? (
          <p className="mt-1 text-sm font-medium tabular-nums">
            {usage.limit === null
              ? t('careSettings.usageUnlimited', { used: usage.used })
              : t('careSettings.usage', { used: usage.used, limit: usage.limit })}
          </p>
        ) : null}
      </div>
      <p className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{t('careSettings.metaRule')}</span>
      </p>
      {settings.data && autonomy.data ? (
        <CareForm settings={settings.data} actions={autonomy.data.actions} />
      ) : settings.isError || autonomy.isError ? (
        <p className="text-sm text-muted-foreground">{t('careSettings.loadError')}</p>
      ) : (
        <Skeleton className="h-64 rounded-lg" />
      )}
    </section>
  );
}

interface TemplateForm extends Omit<CareTemplateDto, 'afterSaleDays'> {
  afterSaleDays: string;
}

function toForm(t: CareTemplateDto): TemplateForm {
  return { ...t, afterSaleDays: String(t.afterSaleDays) };
}

function daysValid(value: string): boolean {
  const n = Number(value);
  return Number.isInteger(n) && n >= CARE_AFTER_SALE_DAYS.min && n <= CARE_AFTER_SALE_DAYS.max;
}

function CareForm({
  settings,
  actions,
}: {
  settings: CareSettingsResponse;
  actions: AutonomyActionDto[];
}) {
  const { t } = useTranslation('brain');
  const canEdit = useCan('settings.manage');
  const save = useSaveCareSettings();
  const [levels, setLevels] = useState(
    () => new Map(actions.map((a) => [a.action, a.level] as const)),
  );
  const [templates, setTemplates] = useState(() => settings.templates.map(toForm));
  const valid = templates.every((tpl) => tpl.key !== 'after_sale' || daysValid(tpl.afterSaleDays));

  function patch(key: TemplateForm['key'], change: Partial<TemplateForm>) {
    setTemplates((all) => all.map((tpl) => (tpl.key === key ? { ...tpl, ...change } : tpl)));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    const change: CareSettingsChange = {
      levels: actions
        .filter((a) => levels.get(a.action) !== a.level)
        .map((a) => ({ action: a.action, level: levels.get(a.action) ?? a.level })),
      templates: templates.flatMap((tpl) => {
        const before = settings.templates.find((b) => b.key === tpl.key);
        const days = Number(tpl.afterSaleDays);
        const same =
          before &&
          before.enabled === tpl.enabled &&
          before.instruction === tpl.instruction.trim() &&
          (tpl.key !== 'after_sale' || before.afterSaleDays === days);
        if (same) return [];
        return [
          {
            key: tpl.key,
            enabled: tpl.enabled,
            instruction: tpl.instruction.trim(),
            ...(tpl.key === 'after_sale' ? { afterSaleDays: days } : {}),
          },
        ];
      }),
    };
    if (change.levels.length === 0 && change.templates.length === 0) {
      toast.info(t('careSettings.nothingChanged'));
      return;
    }
    save.mutate(change, {
      onSuccess: () => toast.success(t('settings.saved')),
      onError: () => toast.error(t('settings.error')),
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-5">
        {actions.map((a) => (
          <div key={a.action} className="flex flex-col gap-2">
            <Label id={`autonomy-${a.action}`}>{t(`autonomy.actions.${a.action}`)}</Label>
            <RadioGroup
              aria-labelledby={`autonomy-${a.action}`}
              value={levels.get(a.action) ?? a.level}
              onValueChange={(v) => setLevels((m) => new Map(m).set(a.action, v as AutonomyLevel))}
              className="gap-2.5"
            >
              {a.levels.map((level) => (
                <div key={level} className="flex items-start gap-2">
                  <RadioGroupItem
                    id={`autonomy-${a.action}-${level}`}
                    value={level}
                    className="mt-0.5"
                    aria-describedby={`autonomy-${a.action}-${level}-hint`}
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Label htmlFor={`autonomy-${a.action}-${level}`} className="font-normal">
                      {t(`autonomy.levels.${level}`)}
                      {level === a.default ? (
                        <span className="text-xs text-muted-foreground">
                          {t('autonomy.default')}
                        </span>
                      ) : null}
                    </Label>
                    <p
                      id={`autonomy-${a.action}-${level}-hint`}
                      className="text-xs text-muted-foreground"
                    >
                      {t(`autonomy.hints.${level}`)}
                    </p>
                  </div>
                </div>
              ))}
            </RadioGroup>
          </div>
        ))}

        <div className="flex flex-col gap-4 border-t pt-5">
          <h3 className="text-sm font-medium">{t('careSettings.templates')}</h3>
          {templates.map((tpl) => (
            <div key={tpl.key} className="flex flex-col gap-3 rounded-lg border p-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Label htmlFor={`care-${tpl.key}`}>{t(`care.template.${tpl.key}`)}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t(`careSettings.when.${tpl.key}`)}
                  </p>
                </div>
                <Switch
                  id={`care-${tpl.key}`}
                  checked={tpl.enabled}
                  onCheckedChange={(on) => patch(tpl.key, { enabled: on })}
                />
              </div>
              {tpl.key === 'after_sale' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor="care-after-sale-days" className="font-normal">
                    {t('careSettings.afterSaleDays')}
                  </Label>
                  <Input
                    id="care-after-sale-days"
                    type="number"
                    inputMode="numeric"
                    min={CARE_AFTER_SALE_DAYS.min}
                    max={CARE_AFTER_SALE_DAYS.max}
                    value={tpl.afterSaleDays}
                    aria-invalid={!daysValid(tpl.afterSaleDays)}
                    className="w-24"
                    disabled={!canEdit || !tpl.enabled}
                    onChange={(e) => patch(tpl.key, { afterSaleDays: e.target.value })}
                  />
                  <span className="text-xs text-muted-foreground">
                    {t('careSettings.afterSaleDaysHint', {
                      min: CARE_AFTER_SALE_DAYS.min,
                      max: CARE_AFTER_SALE_DAYS.max,
                    })}
                  </span>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`care-${tpl.key}-instruction`} className="font-normal">
                    {t('careSettings.instruction')}
                  </Label>
                  <Textarea
                    id={`care-${tpl.key}-instruction`}
                    value={tpl.instruction}
                    maxLength={INSTRUCTION_MAX}
                    rows={2}
                    placeholder={t(`careSettings.placeholder.${tpl.key}`)}
                    disabled={!canEdit || !tpl.enabled}
                    onChange={(e) => patch(tpl.key, { instruction: e.target.value })}
                    className="min-h-16 text-sm"
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        <dl className="grid gap-x-4 gap-y-2 border-t pt-5 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">{t('careSettings.quietHours')}</dt>
          <dd>
            {t('careSettings.quietHoursValue', {
              from: hour(settings.quietHours.from),
              to: hour(settings.quietHours.to),
            })}
          </dd>
          <dt className="text-muted-foreground">{t('careSettings.perConversation')}</dt>
          <dd>
            {t('careSettings.perConversationValue', { count: settings.maxPerConversationPerDay })}
          </dd>
          <dt className="text-muted-foreground">{t('careSettings.dailyCap')}</dt>
          <dd className="tabular-nums">
            {settings.usage.limit === null
              ? t('careSettings.dailyCapUnlimited')
              : t('careSettings.dailyCapValue', { count: settings.usage.limit })}
          </dd>
        </dl>
      </fieldset>
      {canEdit ? (
        <div>
          <Button type="submit" disabled={save.isPending || !valid}>
            {t('settings.save')}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('settings.readOnly')}</p>
      )}
    </form>
  );
}
