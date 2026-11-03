import {
  ALERT_INTERVALS,
  ALERT_TEMPLATES,
  type Cadence,
  type ScheduleChannel,
  ScheduleDraft,
  type ScheduleDto,
  type ScheduleMode,
  type SchedulePreview,
  type ScheduleTemplate,
  isRequestIndustry,
  scheduleParamsSchema,
} from '@agent-sales/contracts';
import type { TFunction } from 'i18next';
import { Loader2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ApiClientError } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';

import { useCreateSchedule, usePreviewSchedule, useUpdateSchedule } from '../api/schedules';
import { useAccountBusinesses } from '../hooks/use-businesses';

const TEMPLATES: readonly ScheduleTemplate[] = [
  'revenue_summary',
  'new_orders',
  'low_stock',
  'unanswered_conversations',
  'new_customers',
  'new_requests',
];
/** Templates about orders and stock, which a training centre or spa does not have. */
const ORDER_TEMPLATES: readonly ScheduleTemplate[] = ['revenue_summary', 'new_orders', 'low_stock'];
/** Businesses that sell courses or services rather than goods (T-187). */
const sellsOfferings = (industry: string | undefined) =>
  industry === 'education' || industry === 'spa';

/**
 * The templates offered for a business: `new_requests` only where the bot records requests
 * (education, spa, saas; T-187), and no order or stock template for a training centre or spa.
 * The schedule's current template is always kept.
 */
export function templatesFor(industry: string | undefined, current?: ScheduleTemplate) {
  return TEMPLATES.filter((tp) => {
    if (tp === current) return true;
    if (tp === 'new_requests') return industry !== undefined && isRequestIndustry(industry);
    return !(sellsOfferings(industry) && ORDER_TEMPLATES.includes(tp));
  });
}

/** What a new schedule reports on first: new requests for a training centre or spa. */
export function defaultTemplate(industry: string | undefined): ScheduleTemplate {
  return sellsOfferings(industry) ? 'new_requests' : 'revenue_summary';
}
/** `every` intervals a report may use (at least an hour). */
export const REPORT_INTERVALS = [60, 120, 180, 240, 360, 720, 1440] as const;
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const MONTH_DAYS = [...Array.from({ length: 28 }, (_, i) => i + 1), -1];
const DEFAULT_AT = '08:00';

type Form = Omit<ScheduleDraft, 'params'> & { params: Record<string, unknown> };

/** The modes a template allows: every template reports; only some alert. */
export function modesFor(template: ScheduleTemplate): ScheduleMode[] {
  return ALERT_TEMPLATES.includes(template) ? ['report', 'alert'] : ['report'];
}

/** The `every` intervals a mode allows, in minutes. */
export function intervalsFor(mode: ScheduleMode): readonly number[] {
  return mode === 'alert' ? ALERT_INTERVALS : REPORT_INTERVALS;
}

const defaultParams = (template: ScheduleTemplate, mode: ScheduleMode) =>
  scheduleParamsSchema(template, mode).parse({}) as Record<string, unknown>;

const atOf = (c: Cadence) => (c.kind === 'every' ? DEFAULT_AT : c.at);

function cadenceOfKind(kind: Cadence['kind'], prev: Cadence, mode: ScheduleMode): Cadence {
  const at = atOf(prev);
  switch (kind) {
    case 'daily':
      return { kind, at };
    case 'weekly':
      return { kind, days: [1], at };
    case 'monthly':
      return { kind, day: 1, at };
    case 'every':
      return { kind, minutes: mode === 'alert' ? 30 : 60 };
  }
}

/** A cadence the mode allows: an alert runs on `every` only, at an allowed interval. */
function fitCadence(c: Cadence, mode: ScheduleMode): Cadence {
  if (mode === 'alert' && c.kind !== 'every') return cadenceOfKind('every', c, mode);
  if (c.kind === 'every' && !intervalsFor(mode).includes(c.minutes)) {
    return { ...c, minutes: mode === 'alert' ? 30 : 60 };
  }
  return c;
}

function initialForm(
  initial: ScheduleDto | Partial<ScheduleDraft> | undefined,
  businessId: string,
  industry: string | undefined,
): Form {
  const template = initial?.template ?? defaultTemplate(industry);
  const mode = initial?.mode && modesFor(template).includes(initial.mode) ? initial.mode : 'report';
  return {
    name: initial?.name ?? '',
    businessId: initial?.businessId ?? businessId,
    template,
    mode,
    params: { ...defaultParams(template, mode), ...(initial?.params ?? {}) },
    cadence: initial?.cadence ?? { kind: 'daily', at: DEFAULT_AT },
    channels: initial?.channels?.length
      ? [...new Set<ScheduleChannel>(['in_app', ...initial.channels])]
      : ['in_app'],
    commentary: initial?.commentary ?? false,
  };
}

/** One labelled control. */
function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function NumberParam({
  name,
  form,
  setParam,
}: {
  name: 'minCount' | 'threshold' | 'minutes';
  form: Form;
  setParam: (name: string, value: unknown) => void;
}) {
  const { t } = useTranslation('assistant');
  const id = `${useId()}-${name}`;
  return (
    <Field id={id} label={t(`schedules.fields.${name}`)}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        value={String(form.params[name] ?? '')}
        onChange={(e) => setParam(name, e.target.value === '' ? '' : Number(e.target.value))}
      />
    </Field>
  );
}

/** The template's params: a period for reports, thresholds for the others. */
function ParamsFields({
  form,
  setParam,
}: {
  form: Form;
  setParam: (name: string, value: unknown) => void;
}) {
  const { t } = useTranslation('assistant');
  const id = useId();
  const { template, mode } = form;
  if (template === 'low_stock')
    return <NumberParam name="threshold" form={form} setParam={setParam} />;
  if (template === 'unanswered_conversations') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <NumberParam name="minutes" form={form} setParam={setParam} />
        <NumberParam name="minCount" form={form} setParam={setParam} />
      </div>
    );
  }
  if ((template === 'new_orders' || template === 'new_requests') && mode === 'alert') {
    return <NumberParam name="minCount" form={form} setParam={setParam} />;
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field id={`${id}-period`} label={t('schedules.fields.period')}>
        <Select value={String(form.params['period'])} onValueChange={(v) => setParam('period', v)}>
          <SelectTrigger id={`${id}-period`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['day', 'week', 'month'] as const).map((p) => (
              <SelectItem key={p} value={p}>
                {t(`schedules.periods.${p}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field id={`${id}-window`} label={t('schedules.fields.window')}>
        <Select value={String(form.params['window'])} onValueChange={(v) => setParam('window', v)}>
          <SelectTrigger id={`${id}-window`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['previous', 'to_date'] as const).map((w) => (
              <SelectItem key={w} value={w}>
                {t(`schedules.windows.${w}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

/** daily / weekly / monthly / every, with the time, weekdays, day of month or interval. */
function CadenceFields({ form, setCadence }: { form: Form; setCadence: (c: Cadence) => void }) {
  const { t } = useTranslation('assistant');
  const id = useId();
  const c = form.cadence;
  const kinds: Cadence['kind'][] =
    form.mode === 'alert' ? ['every'] : ['daily', 'weekly', 'monthly', 'every'];
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-1.5 text-sm font-medium">{t('schedules.fields.cadence')}</legend>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        className="flex-wrap"
        value={c.kind}
        onValueChange={(v) => v && setCadence(cadenceOfKind(v as Cadence['kind'], c, form.mode))}
        aria-label={t('schedules.fields.cadence')}
      >
        {(['daily', 'weekly', 'monthly', 'every'] as const).map((k) => (
          <ToggleGroupItem key={k} value={k} disabled={!kinds.includes(k)}>
            {t(`schedules.cadenceKinds.${k}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {c.kind === 'weekly' ? (
        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          className="flex-wrap"
          value={c.days.map(String)}
          onValueChange={(v) => {
            const days = v.map(Number).sort((a, b) => a - b);
            if (days.length) setCadence({ ...c, days });
          }}
          aria-label={t('schedules.fields.days')}
        >
          {WEEKDAYS.map((d) => (
            <ToggleGroupItem key={d} value={String(d)} aria-label={t(`schedules.weekdays.${d}`)}>
              {t(`schedules.weekdaysShort.${d}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        {c.kind === 'monthly' ? (
          <Field id={`${id}-day`} label={t('schedules.fields.day')}>
            <Select
              value={String(c.day)}
              onValueChange={(v) => setCadence({ ...c, day: Number(v) })}
            >
              <SelectTrigger id={`${id}-day`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_DAYS.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d === -1 ? t('schedules.lastDay') : String(d)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        {c.kind === 'every' ? (
          <Field id={`${id}-interval`} label={t('schedules.fields.interval')}>
            <Select
              value={String(c.minutes)}
              onValueChange={(v) => setCadence({ ...c, minutes: Number(v) })}
            >
              <SelectTrigger id={`${id}-interval`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {intervalsFor(form.mode).map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m % 60 === 0
                      ? t('schedules.cadence.hours', { count: m / 60 })
                      : t('schedules.cadence.minutes', { count: m })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : (
          <Field id={`${id}-at`} label={t('schedules.fields.at')}>
            <Input
              id={`${id}-at`}
              type="time"
              value={c.at}
              onChange={(e) => e.target.value && setCadence({ ...c, at: e.target.value })}
            />
          </Field>
        )}
      </div>
    </fieldset>
  );
}

/** The server's reason code, or the first field of a client-side Zod issue. */
function errorText(error: unknown, t: TFunction<'assistant'>): string {
  const reason =
    error instanceof ApiClientError ? (error.details?.['reason'] as string | undefined) : undefined;
  if (reason)
    return t(`schedules.errors.${reason}`, { defaultValue: t('schedules.errors.generic') });
  if (error instanceof ApiClientError && error.status === 409)
    return t('schedules.errors.stale_schedule');
  return t('schedules.errors.generic');
}

/**
 * Create or edit a schedule (T-172). The form is validated with the same `ScheduleDraft` as the
 * server; "Xem thử" computes the report now. Saving is the owner's own action (no proposal).
 */
export function ScheduleEditor({
  schedule,
  draft,
  emailAvailable,
  onDone,
}: {
  /** The schedule being edited. */
  schedule?: ScheduleDto | undefined;
  /** A new schedule's starting values (e.g. an accepted suggestion). */
  draft?: Partial<ScheduleDraft> | undefined;
  emailAvailable: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation('assistant');
  const id = useId();
  const ws = useWorkspaceId();
  const businesses = useAccountBusinesses();
  const [form, setForm] = useState<Form>(() => {
    const initial = schedule ?? draft;
    const businessId = initial?.businessId ?? ws;
    return initialForm(initial, ws, businesses.find((b) => b.id === businessId)?.industry);
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const create = useCreateSchedule();
  const update = useUpdateSchedule();
  const previewMutation = usePreviewSchedule();
  const saving = create.isPending || update.isPending;
  const hadEmail = schedule?.channels.includes('email') ?? false;
  const emailDisabled = !emailAvailable && !hadEmail;

  function change(next: Partial<Form>): void {
    setForm((f) => ({ ...f, ...next }));
    setProblem(null);
    setPreview(null);
  }

  function setTemplate(template: ScheduleTemplate): void {
    const mode = modesFor(template).includes(form.mode) ? form.mode : 'report';
    change({
      template,
      mode,
      params: defaultParams(template, mode),
      cadence: fitCadence(form.cadence, mode),
    });
  }

  /** Another business; a template it does not offer gives way to its default one. */
  function setBusiness(businessId: string): void {
    const industry = businesses.find((b) => b.id === businessId)?.industry;
    if (templatesFor(industry).includes(form.template)) {
      change({ businessId });
      return;
    }
    const template = defaultTemplate(industry);
    const mode = modesFor(template).includes(form.mode) ? form.mode : 'report';
    change({
      businessId,
      template,
      mode,
      params: defaultParams(template, mode),
      cadence: fitCadence(form.cadence, mode),
    });
  }

  function setMode(mode: ScheduleMode): void {
    change({
      mode,
      params: defaultParams(form.template, mode),
      cadence: fitCadence(form.cadence, mode),
    });
  }

  /** The draft as the server will read it, or null with the problem shown. */
  function validDraft(): ScheduleDraft | null {
    const parsed = ScheduleDraft.safeParse(form);
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? '');
      setProblem(
        t(`schedules.errors.field.${field}`, { defaultValue: t('schedules.errors.generic') }),
      );
      return null;
    }
    return parsed.data;
  }

  async function save(): Promise<void> {
    const d = validDraft();
    if (!d) return;
    try {
      if (schedule) {
        await update.mutateAsync({
          id: schedule.id,
          patch: { ...d, expectedUpdatedAt: schedule.updatedAt },
        });
      } else {
        await create.mutateAsync(d);
      }
      toast.success(t('schedules.saved'));
      onDone();
    } catch (error) {
      setProblem(errorText(error, t));
    }
  }

  async function showPreview(): Promise<void> {
    const d = validDraft();
    if (!d) return;
    try {
      setPreview(await previewMutation.mutateAsync(d));
    } catch (error) {
      setProblem(errorText(error, t));
    }
  }

  const modes = modesFor(form.template);
  return (
    <form
      className="flex min-w-0 flex-col gap-4"
      aria-label={schedule ? t('schedules.editTitle') : t('schedules.newTitle')}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h3 className="font-medium">
        {schedule ? t('schedules.editTitle') : t('schedules.newTitle')}
      </h3>
      <Field id={`${id}-name`} label={t('schedules.fields.name')}>
        <Input
          id={`${id}-name`}
          value={form.name}
          maxLength={80}
          onChange={(e) => change({ name: e.target.value })}
        />
      </Field>
      <Field id={`${id}-business`} label={t('schedules.fields.business')}>
        <Select value={form.businessId} onValueChange={setBusiness}>
          <SelectTrigger id={`${id}-business`} className="w-full min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {businesses.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field id={`${id}-template`} label={t('schedules.fields.template')}>
        <Select value={form.template} onValueChange={(v) => setTemplate(v as ScheduleTemplate)}>
          <SelectTrigger id={`${id}-template`} className="w-full min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {templatesFor(
              businesses.find((b) => b.id === form.businessId)?.industry,
              form.template,
            ).map((tp) => (
              <SelectItem key={tp} value={tp}>
                {t(`schedules.templates.${tp}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t('schedules.fields.mode')}</span>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={form.mode}
          onValueChange={(v) => v && setMode(v as ScheduleMode)}
          aria-label={t('schedules.fields.mode')}
        >
          {modes.map((m) => (
            <ToggleGroupItem key={m} value={m}>
              {t(`schedules.modes.${m}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <ParamsFields
        form={form}
        setParam={(name, value) => change({ params: { ...form.params, [name]: value } })}
      />
      <CadenceFields form={form} setCadence={(cadence) => change({ cadence })} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">{t('schedules.fields.channels')}</legend>
        <div className="flex items-center gap-2">
          <Checkbox id={`${id}-in-app`} checked disabled aria-describedby={`${id}-in-app-note`} />
          <Label htmlFor={`${id}-in-app`}>{t('schedules.channels.in_app')}</Label>
          <span id={`${id}-in-app-note`} className="text-xs text-muted-foreground">
            {t('schedules.inAppLocked')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${id}-email`}
            checked={form.channels.includes('email')}
            disabled={emailDisabled}
            aria-describedby={emailDisabled ? `${id}-email-note` : undefined}
            onCheckedChange={(on) =>
              change({ channels: on === true ? ['in_app', 'email'] : ['in_app'] })
            }
          />
          <Label htmlFor={`${id}-email`}>{t('schedules.channels.email')}</Label>
        </div>
        {emailDisabled ? (
          <p id={`${id}-email-note`} className="text-xs text-muted-foreground">
            {t('schedules.emailUnavailable')}
          </p>
        ) : null}
      </fieldset>
      <div className="flex items-start gap-2">
        <Switch
          id={`${id}-commentary`}
          checked={form.commentary}
          onCheckedChange={(on) => change({ commentary: on })}
          aria-describedby={`${id}-commentary-note`}
        />
        <div className="flex flex-col gap-0.5">
          <Label htmlFor={`${id}-commentary`}>{t('schedules.fields.commentary')}</Label>
          <p id={`${id}-commentary-note`} className="text-xs text-muted-foreground">
            {t('schedules.commentaryNote')}
          </p>
        </div>
      </div>
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
      {preview ? (
        <Card size="sm" data-testid="schedule-preview">
          <CardHeader>
            <CardTitle className="text-sm break-words">{preview.title}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm break-words whitespace-pre-line">
            {preview.body}
          </CardContent>
        </Card>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {t('schedules.save')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={previewMutation.isPending}
          onClick={() => void showPreview()}
        >
          {t('schedules.preview')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t('schedules.cancel')}
        </Button>
      </div>
    </form>
  );
}
