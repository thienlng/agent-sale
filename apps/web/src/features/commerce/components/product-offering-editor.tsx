import type { OfferingDetails } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

export type OfferingKind = OfferingDetails['kind'];
type Format = NonNullable<OfferingDetails['format']>;

/** The offering fields as typed in the form; numbers stay text until saved. */
export interface OfferingDraft {
  durationMinutes: string;
  sessions: string;
  period: string;
  format: Format | null;
  level: string;
  schedule: string;
  audience: string;
  /** One outcome per line. */
  outcomes: string;
  priceNote: string;
}

export const FORMATS: readonly Format[] = ['online', 'offline', 'hybrid'];
const NO_FORMAT = 'none';
const MAX_OUTCOMES = 5;
/** The `commerce.offering` key of a field label; one wording for every service business. */
export function offeringLabelKey(_kind: OfferingKind, key: string): string {
  return `commerce.offering.${key}`;
}

/**
 * The key of a catalog word for a service business ("Dịch vụ mới", "Lưu dịch vụ"): courses
 * and spa services share `products.service`; `fallback` (the product word) otherwise.
 */
export function catalogKey(
  kind: OfferingKind | null | undefined,
  key: string,
  fallback: string,
): string {
  return kind ? `products.service.${key}` : fallback;
}

export function offeringDraft(offering: OfferingDetails | null | undefined): OfferingDraft {
  return {
    durationMinutes: offering?.durationMinutes ? String(offering.durationMinutes) : '',
    sessions: offering?.sessions ? String(offering.sessions) : '',
    period: offering?.period ?? '',
    format: offering?.format ?? null,
    level: offering?.level ?? '',
    schedule: offering?.schedule ?? '',
    audience: offering?.audience ?? '',
    outcomes: offering?.outcomes.join('\n') ?? '',
    priceNote: offering?.priceNote ?? '',
  };
}

/** A whole number within the contract's bounds, or null when empty or out of range. */
function count(text: string, min: number, max: number): number | null {
  const n = Number(text.replace(/\D/g, ''));
  return text.trim() && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** The draft as the `offering` of `UpsertProductRequest` (spec §4.2 limits). */
export function toOffering(draft: OfferingDraft, kind: OfferingKind): OfferingDetails {
  return {
    kind,
    durationMinutes: count(draft.durationMinutes, 5, 1440),
    sessions: count(draft.sessions, 1, 1000),
    period: draft.period.trim(),
    format: draft.format,
    level: draft.level.trim(),
    schedule: draft.schedule.trim(),
    audience: draft.audience.trim(),
    outcomes: draft.outcomes
      .split('\n')
      .map((line) => line.trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, MAX_OUTCOMES),
    priceNote: draft.priceNote.trim(),
  };
}

/**
 * "Chi tiết khoá học" / "Chi tiết dịch vụ" of an education or spa business: how long, how many
 * sessions, format, level, schedule, audience, outcomes and a price note. The "Đây là sản phẩm
 * bán lẻ" switch turns the product back into retail goods with stock (`offering: null`).
 */
export function ProductOfferingEditor({
  kind,
  retail,
  onRetailChange,
  value,
  onChange,
}: {
  kind: OfferingKind;
  retail: boolean;
  onRetailChange: (retail: boolean) => void;
  value: OfferingDraft;
  onChange: (value: OfferingDraft) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`commerce.offering.${key}`);
  /** Field labels are shared by every service business. */
  const label = tr;
  // A spa service has no level; it stays visible only when one was already saved.
  const showLevel = kind === 'course' || Boolean(value.level.trim());
  const set = (patch: Partial<OfferingDraft>) => onChange({ ...value, ...patch });
  const text = (
    key: 'period' | 'level' | 'audience' | 'priceNote',
    max: number,
    extra: { placeholder?: string; hint?: string } = {},
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`po-${key}`}>{label(key)}</Label>
      <Input
        id={`po-${key}`}
        maxLength={max}
        value={value[key]}
        onChange={(e) => set({ [key]: e.target.value })}
        {...(extra.placeholder ? { placeholder: extra.placeholder } : {})}
        {...(extra.hint ? { 'aria-describedby': `po-${key}-hint` } : {})}
      />
      {extra.hint ? (
        <p id={`po-${key}-hint`} className="text-sm text-muted-foreground">
          {extra.hint}
        </p>
      ) : null}
    </div>
  );
  const number = (key: 'durationMinutes' | 'sessions', min: number, max: number) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`po-${key}`}>{label(key)}</Label>
      <Input
        id={`po-${key}`}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        className="tabular-nums"
        value={value[key]}
        onChange={(e) => set({ [key]: e.target.value.replace(/\D/g, '').slice(0, 4) })}
      />
    </div>
  );

  return (
    <section className="rounded-xl border bg-card p-4 md:p-5" aria-labelledby="po-title">
      <div className="space-y-1">
        <h2 id="po-title" className="font-semibold">
          {tr('title')}
        </h2>
        {retail ? null : <p className="text-sm text-muted-foreground">{tr('hint')}</p>}
      </div>
      <div className="mt-4 flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="space-y-1">
          <Label htmlFor="po-retail">{tr('retail')}</Label>
          <p id="po-retail-hint" className="text-sm text-muted-foreground">
            {tr('retailHint')}
          </p>
        </div>
        <Switch
          id="po-retail"
          aria-describedby="po-retail-hint"
          checked={retail}
          onCheckedChange={onRetailChange}
        />
      </div>
      {retail ? null : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {number('durationMinutes', 5, 1440)}
          {number('sessions', 1, 1000)}
          {text('period', 60, { placeholder: label('periodPlaceholder') })}
          {showLevel ? text('level', 120) : null}
          <div className="flex flex-col gap-2 md:col-span-2">
            <Label id="po-format-label">{tr('format')}</Label>
            <RadioGroup
              aria-labelledby="po-format-label"
              className="flex flex-wrap gap-x-5 gap-y-2"
              value={value.format ?? NO_FORMAT}
              onValueChange={(v) => set({ format: v === NO_FORMAT ? null : (v as Format) })}
            >
              {[NO_FORMAT, ...FORMATS].map((f) => (
                <label key={f} className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value={f} />
                  {tr(`formats.${f}`)}
                </label>
              ))}
            </RadioGroup>
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <Label htmlFor="po-schedule">{label('schedule')}</Label>
            <Textarea
              id="po-schedule"
              rows={2}
              maxLength={500}
              value={value.schedule}
              onChange={(e) => set({ schedule: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">{text('audience', 300)}</div>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <Label htmlFor="po-outcomes">{label('outcomes')}</Label>
            <Textarea
              id="po-outcomes"
              rows={3}
              maxLength={MAX_OUTCOMES * 201}
              aria-describedby="po-outcomes-hint"
              value={value.outcomes}
              onChange={(e) => set({ outcomes: e.target.value })}
            />
            <p id="po-outcomes-hint" className="text-sm text-muted-foreground">
              {tr('outcomesHint')}
            </p>
          </div>
          <div className="md:col-span-2">
            {text('priceNote', 120, { hint: tr('priceNoteHint') })}
          </div>
        </div>
      )}
    </section>
  );
}
