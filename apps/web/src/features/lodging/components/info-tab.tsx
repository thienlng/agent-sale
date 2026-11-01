import type { PropertyDto, SellMode } from '@agent-sales/contracts';
import { Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

import { useUpdateProperty } from '../api/properties';
import { useSaveError } from '../hooks/use-save-error';
import { Field, intOrNull, TabSaveBar, useReportDirty, useTabDraft } from './property-tab-parts';

interface InfoDraft {
  code: string;
  name: string;
  area: string;
  address: string;
  description: string;
  active: boolean;
  sellMode: SellMode;
  standardAdults: string;
  standardChildren: string;
  maxGuests: string;
  amenities: string;
  layout: Array<{ name: string; beds: string; note: string }>;
}

const infoOf = (p: PropertyDto): InfoDraft => ({
  code: p.code,
  name: p.name,
  area: p.area,
  address: p.address,
  description: p.description,
  active: p.status === 'active',
  sellMode: p.sellMode,
  standardAdults: String(p.standardAdults),
  standardChildren: String(p.standardChildren),
  maxGuests: p.maxGuests === null ? '' : String(p.maxGuests),
  amenities: p.amenities.join('\n'),
  layout: p.layout,
});

type InfoErrors = Partial<
  Record<'code' | 'name' | 'standardAdults' | 'standardChildren' | 'maxGuests', true>
>;

function validate(d: InfoDraft): InfoErrors {
  const e: InfoErrors = {};
  if (!/^[A-Za-z0-9-]{1,20}$/.test(d.code.trim())) e.code = true;
  if (!d.name.trim()) e.name = true;
  const adults = intOrNull(d.standardAdults);
  if (adults === null || adults < 1) e.standardAdults = true;
  const children = intOrNull(d.standardChildren);
  if (children === null || children < 0) e.standardChildren = true;
  const max = intOrNull(d.maxGuests);
  if (d.maxGuests.trim() && (max === null || max < 1)) e.maxGuests = true;
  return e;
}

/** "Thông tin" tab: identity, sell mode, status, standard capacity, amenities, layout. */
export function InfoTab({
  property: p,
  canEdit,
  onDirtyChange,
}: {
  property: PropertyDto;
  canEdit: boolean;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const base = useMemo(() => infoOf(p), [p]);
  const { draft: d, setDraft, dirty, discard } = useTabDraft(base);
  useReportDirty(dirty, onDirtyChange);
  const update = useUpdateProperty();
  const saveError = useSaveError();
  const errors = validate(d);
  const set = (patch: Partial<InfoDraft>) => setDraft((v) => ({ ...v, ...patch }));
  const err = (key: keyof InfoErrors) => (errors[key] ? t('lodging.places.required') : undefined);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (Object.keys(errors).length || update.isPending || !canEdit) return;
    update.mutate(
      {
        id: p.id,
        body: {
          version: p.version,
          patch: {
            code: d.code.trim(),
            name: d.name.trim(),
            area: d.area.trim(),
            address: d.address.trim(),
            description: d.description.trim(),
            status: d.active ? 'active' : 'paused',
            sellMode: d.sellMode,
            standardAdults: intOrNull(d.standardAdults) ?? 1,
            standardChildren: intOrNull(d.standardChildren) ?? 0,
            maxGuests: intOrNull(d.maxGuests),
            amenities: d.amenities
              .split('\n')
              .map((a) => a.trim())
              .filter(Boolean),
            layout: d.layout
              .filter((l) => l.name.trim())
              .map((l) => ({ name: l.name.trim(), beds: l.beds.trim(), note: l.note.trim() })),
          },
        },
      },
      {
        onSuccess: (saved) => {
          setDraft(infoOf(saved));
          toast.success(t('lodging.editor.saved'), { duration: 3500 });
        },
        onError: (error) =>
          saveError(error, {
            onStale: discard,
            // Sell-mode refusals list the blocking bookings; a taken code has no codes.
            conflict: (e) => {
              const codes = e.details?.['codes'];
              return Array.isArray(codes)
                ? t('lodging.info.sellModeConflict', { codes: codes.join(', ') })
                : t('lodging.info.codeTaken');
            },
          }),
      },
    );
  };

  const text = (key: 'code' | 'name' | 'area' | 'address', max: number) => (
    <Field
      id={`${id}-${key}`}
      label={t(`lodging.info.${key}`)}
      error={key === 'code' || key === 'name' ? err(key) : undefined}
    >
      <Input
        id={`${id}-${key}`}
        value={d[key]}
        maxLength={max}
        disabled={!canEdit}
        aria-invalid={(key === 'code' || key === 'name') && errors[key] ? true : undefined}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </Field>
  );
  const count = (key: 'standardAdults' | 'standardChildren' | 'maxGuests', hint?: string) => (
    <Field id={`${id}-${key}`} label={t(`lodging.info.${key}`)} hint={hint} error={err(key)}>
      <Input
        id={`${id}-${key}`}
        type="number"
        inputMode="numeric"
        min={key === 'standardChildren' ? 0 : 1}
        className="w-32"
        value={d[key]}
        disabled={!canEdit}
        aria-invalid={errors[key] || undefined}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </Field>
  );

  return (
    <form onSubmit={submit} noValidate className="grid max-w-3xl gap-5">
      <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        {text('code', 20)}
        {text('name', 200)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {text('area', 200)}
        {text('address', 500)}
      </div>
      <Field id={`${id}-description`} label={t('lodging.info.description')}>
        <Textarea
          id={`${id}-description`}
          rows={4}
          maxLength={5000}
          value={d.description}
          disabled={!canEdit}
          onChange={(e) => set({ description: e.target.value })}
        />
      </Field>
      <div className="flex items-start gap-3 rounded-lg border p-3">
        <Switch
          id={`${id}-active`}
          checked={d.active}
          disabled={!canEdit}
          onCheckedChange={(active) => set({ active })}
        />
        <div className="grid gap-0.5">
          <Label htmlFor={`${id}-active`}>{t('lodging.info.status')}</Label>
          <p className="text-xs text-muted-foreground">{t('lodging.info.statusHint')}</p>
        </div>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t('lodging.info.sellMode')}</legend>
        <RadioGroup
          value={d.sellMode}
          onValueChange={(v) => set({ sellMode: v as SellMode })}
          disabled={!canEdit}
          className="flex flex-wrap gap-4"
        >
          {(['whole', 'rooms'] as const).map((mode) => (
            <div key={mode} className="flex items-center gap-2">
              <RadioGroupItem id={`${id}-mode-${mode}`} value={mode} />
              <Label htmlFor={`${id}-mode-${mode}`}>{t(`lodging.sellMode.${mode}`)}</Label>
            </div>
          ))}
        </RadioGroup>
        <p className="text-xs text-muted-foreground">{t('lodging.info.sellModeHint')}</p>
      </fieldset>
      <div className="flex flex-wrap gap-4">
        {count('standardAdults')}
        {count('standardChildren')}
        {count('maxGuests', t('lodging.info.maxGuestsHint'))}
      </div>
      <Field
        id={`${id}-amenities`}
        label={t('lodging.info.amenities')}
        hint={t('lodging.info.amenitiesHint')}
      >
        <Textarea
          id={`${id}-amenities`}
          rows={4}
          value={d.amenities}
          disabled={!canEdit}
          onChange={(e) => set({ amenities: e.target.value })}
        />
      </Field>
      <LayoutEditor value={d.layout} disabled={!canEdit} onChange={(layout) => set({ layout })} />
      <TabSaveBar
        dirty={dirty}
        pending={update.isPending}
        canEdit={canEdit}
        label={t('lodging.editor.save')}
      />
    </form>
  );
}

function LayoutEditor({
  value,
  disabled,
  onChange,
}: {
  value: InfoDraft['layout'];
  disabled: boolean;
  onChange: (layout: InfoDraft['layout']) => void;
}) {
  const { t } = useTranslation();
  const setRow = (i: number, patch: Partial<InfoDraft['layout'][number]>) =>
    onChange(value.map((r, j) => (i === j ? { ...r, ...patch } : r)));
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">{t('lodging.info.layout')}</legend>
      <p className="text-xs text-muted-foreground">{t('lodging.info.layoutHint')}</p>
      {value.map((row, i) => (
        <div
          key={i}
          className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto]"
        >
          <Input
            aria-label={`${t('lodging.info.layoutName')} ${i + 1}`}
            placeholder={t('lodging.info.layoutName')}
            value={row.name}
            maxLength={100}
            disabled={disabled}
            onChange={(e) => setRow(i, { name: e.target.value })}
          />
          <Input
            aria-label={`${t('lodging.info.layoutBeds')} ${i + 1}`}
            placeholder={t('lodging.info.layoutBeds')}
            value={row.beds}
            maxLength={500}
            disabled={disabled}
            onChange={(e) => setRow(i, { beds: e.target.value })}
          />
          <Input
            aria-label={`${t('lodging.info.layoutNote')} ${i + 1}`}
            placeholder={t('lodging.info.layoutNote')}
            value={row.note}
            maxLength={500}
            disabled={disabled}
            onChange={(e) => setRow(i, { note: e.target.value })}
          />
          {!disabled && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t('lodging.info.removeLayout', { name: row.name || i + 1 })}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <Trash2 aria-hidden />
            </Button>
          )}
        </div>
      ))}
      {!disabled && value.length < 100 && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="justify-self-start"
          onClick={() => onChange([...value, { name: '', beds: '', note: '' }])}
        >
          <Plus aria-hidden />
          {t('lodging.info.addLayout')}
        </Button>
      )}
    </fieldset>
  );
}
