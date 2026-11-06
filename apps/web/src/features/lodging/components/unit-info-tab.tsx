import {
  type PropertyDto,
  type UnitCategory,
  UnitCategory as UnitCategoryEnum,
  type UnitDto,
} from '@agent-sales/contracts';
import { type FormEvent, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

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

import { useReplaceUnits } from '../api/properties';
import { useSaveError } from '../hooks/use-save-error';
import { unitsWith } from '../lib/units-model';
import { Field, intOrNull, TabSaveBar, useReportDirty, useTabDraft } from './property-tab-parts';

interface UnitInfoDraft {
  name: string;
  category: UnitCategory;
  view: string;
  area: string;
  beds: string;
  adults: string;
  children: string;
  max: string;
  description: string;
  amenities: string;
  active: boolean;
}

const infoOf = (u: UnitDto): UnitInfoDraft => ({
  name: u.name,
  category: u.category,
  view: u.view,
  area: u.areaM2 === null ? '' : String(u.areaM2),
  beds: u.beds,
  adults: String(u.capacityAdults),
  children: String(u.capacityChildren),
  max: u.maxGuests === null ? '' : String(u.maxGuests),
  description: u.description,
  amenities: u.amenities.join('\n'),
  active: u.active,
});

const amenityList = (text: string) =>
  text
    .split('\n')
    .map((a) => a.trim())
    .filter(Boolean);

type UnitField = 'name' | 'adults' | 'children' | 'max' | 'area' | 'amenities';
/** Problem per field; each maps to `units.errors.<code>` (lodging namespace). */
type UnitErrors = Partial<Record<UnitField, string>>;

const inRange = (raw: string, min: number, max: number) => {
  const n = intOrNull(raw);
  return n !== null && n >= min && n <= max;
};

/** Mirrors the server limits of `UnitInput`. */
export function validateUnitInfo(d: UnitInfoDraft): UnitErrors {
  const e: UnitErrors = {};
  if (!d.name.trim()) e.name = 'nameRequired';
  if (!inRange(d.adults, 1, 100)) e.adults = 'adultsInvalid';
  if (!inRange(d.children || '0', 0, 100)) e.children = 'childrenInvalid';
  if (d.max.trim() && !inRange(d.max, 1, 2000)) e.max = 'maxInvalid';
  if (d.area.trim() && !inRange(d.area, 1, 100_000)) e.area = 'areaInvalid';
  const amenities = amenityList(d.amenities);
  if (amenities.length > 40 || amenities.some((a) => a.length > 200))
    e.amenities = 'amenitiesInvalid';
  return e;
}

/**
 * "Thông tin" tab of a unit page: name, type, view, area, beds, standard and maximum party,
 * description, own amenities and on sale. Saving sends every unit of the property as loaded,
 * with this one changed (`PUT units`), so the other units and this unit's photos are kept.
 */
export function UnitInfoTab({
  property: p,
  unit,
  canEdit,
  onDirtyChange,
}: {
  property: PropertyDto;
  unit: UnitDto;
  canEdit: boolean;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useTranslation('lodging');
  const id = useId();
  const base = useMemo(() => infoOf(unit), [unit]);
  const { draft: d, setDraft, dirty, discard } = useTabDraft(base);
  useReportDirty(dirty, onDirtyChange);
  const [submitted, setSubmitted] = useState(false);
  const replace = useReplaceUnits();
  const saveError = useSaveError();
  const errors = validateUnitInfo(d);
  const set = (patch: Partial<UnitInfoDraft>) => setDraft((v) => ({ ...v, ...patch }));
  const err = (key: UnitField) =>
    submitted && errors[key] ? t(`units.errors.${errors[key]}`) : undefined;
  const invalid = (key: UnitField) => (submitted && errors[key] ? true : undefined);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length || replace.isPending || !canEdit) return;
    const units = unitsWith(p, unit.id, {
      name: d.name.trim(),
      category: d.category,
      view: d.view.trim(),
      areaM2: intOrNull(d.area),
      beds: d.beds.trim(),
      capacityAdults: intOrNull(d.adults) ?? 1,
      capacityChildren: intOrNull(d.children || '0') ?? 0,
      maxGuests: intOrNull(d.max),
      description: d.description.trim(),
      amenities: amenityList(d.amenities),
      active: d.active,
    });
    replace.mutate(
      { id: p.id, body: { version: p.version, units } },
      {
        onSuccess: (saved) => {
          const next = saved.units.find((u) => u.id === unit.id);
          if (next) setDraft(infoOf(next));
          setSubmitted(false);
          toast.success(t('editor.saved'), { duration: 3500 });
        },
        onError: (error) =>
          saveError(error, { onStale: discard, conflict: () => t('units.removeConflict') }),
      },
    );
  };

  const text = (key: 'name' | 'view' | 'beds', max: number, placeholder?: string) => (
    <Field
      id={`${id}-${key}`}
      label={t(`units.${key}`)}
      error={key === 'name' ? err('name') : undefined}
    >
      <Input
        id={`${id}-${key}`}
        value={d[key]}
        maxLength={max}
        placeholder={placeholder}
        disabled={!canEdit}
        aria-invalid={key === 'name' ? invalid('name') : undefined}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </Field>
  );
  const count = (
    key: 'adults' | 'children' | 'max' | 'area',
    label: string,
    min: number,
    hint?: string,
  ) => (
    <Field id={`${id}-${key}`} label={label} hint={hint} error={err(key)}>
      <Input
        id={`${id}-${key}`}
        type="number"
        inputMode="numeric"
        min={min}
        value={d[key]}
        disabled={!canEdit}
        aria-invalid={invalid(key)}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </Field>
  );

  return (
    <form onSubmit={submit} noValidate className="grid max-w-3xl gap-5">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        {text('name', 100)}
        <Field id={`${id}-category`} label={t('units.kind')}>
          <Select
            value={d.category}
            disabled={!canEdit}
            onValueChange={(v) => set({ category: v as UnitCategory })}
          >
            <SelectTrigger id={`${id}-category`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UnitCategoryEnum.options.map((k) => (
                <SelectItem key={k} value={k}>
                  {t(`units.category.${k}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        {text('view', 200, t('units.viewPlaceholder'))}
        {count('area', t('units.area'), 1)}
      </div>
      {text('beds', 500, t('units.bedsPlaceholder'))}
      <div className="grid gap-1.5">
        <div className="grid gap-4 sm:grid-cols-3">
          {count('adults', t('units.standardAdults'), 1)}
          {count('children', t('units.standardChildren'), 0)}
          {count('max', t('units.maxGuests'), 1)}
        </div>
        <p className="text-xs text-muted-foreground">
          {t('units.standardHint')} {t('units.maxGuestsHint')}
        </p>
      </div>
      <Field id={`${id}-description`} label={t('units.description')}>
        <Textarea
          id={`${id}-description`}
          rows={4}
          maxLength={2000}
          value={d.description}
          disabled={!canEdit}
          onChange={(e) => set({ description: e.target.value })}
        />
      </Field>
      <Field
        id={`${id}-amenities`}
        label={t('units.amenities')}
        hint={t('units.amenitiesHint')}
        error={err('amenities')}
      >
        <Textarea
          id={`${id}-amenities`}
          rows={4}
          value={d.amenities}
          disabled={!canEdit}
          aria-invalid={invalid('amenities')}
          onChange={(e) => set({ amenities: e.target.value })}
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
          <Label htmlFor={`${id}-active`}>{t('units.status')}</Label>
          <p className="text-xs text-muted-foreground">{t('units.statusHint')}</p>
        </div>
      </div>
      <TabSaveBar
        dirty={dirty}
        pending={replace.isPending}
        canEdit={canEdit}
        label={t('units.save')}
      />
    </form>
  );
}
