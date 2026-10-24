import type { ContactDto, CrmOptionDto } from '@agent-sales/contracts';
import type { InputHTMLAttributes } from 'react';
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
import { Textarea } from '@/components/ui/textarea';

import type { CrmLookups } from '../hooks/use-crm-lookups';

const NONE = '__none';
const PHONE = '\\+?[0-9 .()\\-]{8,20}';

/** The editable profile as form strings ('' = not given). */
export interface ContactDraft {
  name: string;
  phone: string;
  email: string;
  birthday: string;
  gender: string;
  address: string;
  ward: string;
  province: string;
  sourceId: string;
  statusId: string;
  salesUserId: string;
  careUserId: string;
  adRef: string;
  profileNote: string;
}

export const EMPTY_DRAFT: ContactDraft = {
  name: '',
  phone: '',
  email: '',
  birthday: '',
  gender: '',
  address: '',
  ward: '',
  province: '',
  sourceId: '',
  statusId: '',
  salesUserId: '',
  careUserId: '',
  adRef: '',
  profileNote: '',
};

export function draftOf(c: ContactDto): ContactDraft {
  return {
    name: c.name ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    birthday: c.birthday ?? '',
    gender: c.gender ?? '',
    address: c.address ?? '',
    ward: c.ward ?? '',
    province: c.province ?? '',
    sourceId: c.sourceId ?? '',
    statusId: c.statusId ?? '',
    salesUserId: c.salesUserId ?? '',
    careUserId: c.careUserId ?? '',
    adRef: c.adRef ?? '',
    profileNote: c.profileNote,
  };
}

/** Only the fields that differ from `base` ('' becomes null = cleared). */
export function changedFields(draft: ContactDraft, base: ContactDraft) {
  const out: Record<string, string | null> = {};
  for (const k of Object.keys(draft) as Array<keyof ContactDraft>) {
    if (draft[k] !== base[k]) out[k] = k === 'profileNote' ? draft[k] : draft[k].trim() || null;
  }
  return out;
}

function OptionSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<{ id: string; label: string; archived?: boolean }>;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? '' : v)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('crm.field.none')}</SelectItem>
          {options
            // An archived option stays visible only on the customer that has it.
            .filter((o) => !o.archived || o.id === value)
            .map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const opts = (list: CrmOptionDto[]) =>
  list.map((o) => ({ id: o.id, label: o.name, archived: o.archived }));

/** Profile, source/status and ownership fields of a customer. */
export function ContactFields({
  idPrefix,
  value,
  onChange,
  lookups,
  invalid,
}: {
  idPrefix: string;
  value: ContactDraft;
  onChange: (next: ContactDraft) => void;
  lookups: CrmLookups;
  /** Field names the server rejected. */
  invalid?: ReadonlySet<string>;
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<ContactDraft>) => onChange({ ...value, ...patch });
  const text = (
    key: keyof ContactDraft,
    label: string,
    extra: InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={`${idPrefix}-${key}`}>{label}</Label>
      <Input
        id={`${idPrefix}-${key}`}
        value={value[key]}
        onChange={(e) => set({ [key]: e.target.value })}
        aria-invalid={invalid?.has(key) || undefined}
        {...extra}
      />
    </div>
  );
  const members = lookups.assignees.map((m) => ({ id: m.userId, label: m.name }));

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {text('name', t('crm.field.name'), { maxLength: 120, autoComplete: 'off' })}
      {text('phone', t('crm.field.phone'), {
        type: 'tel',
        inputMode: 'tel',
        pattern: PHONE,
        autoComplete: 'off',
      })}
      {text('email', t('crm.field.email'), { type: 'email', maxLength: 254, autoComplete: 'off' })}
      {text('birthday', t('crm.field.birthday'), { type: 'date' })}
      <OptionSelect
        id={`${idPrefix}-gender`}
        label={t('crm.field.gender')}
        value={value.gender}
        options={(['male', 'female', 'other'] as const).map((g) => ({
          id: g,
          label: t(`crm.field.genders.${g}`),
        }))}
        onChange={(gender) => set({ gender })}
      />
      {text('adRef', t('crm.field.adRef'), { maxLength: 120 })}
      <div className="sm:col-span-2">
        {text('address', t('crm.field.address'), { maxLength: 300 })}
      </div>
      {text('ward', t('crm.field.ward'), { maxLength: 120 })}
      {text('province', t('crm.field.province'), { maxLength: 120 })}
      <OptionSelect
        id={`${idPrefix}-source`}
        label={t('crm.field.source')}
        value={value.sourceId}
        options={opts(lookups.sources)}
        onChange={(sourceId) => set({ sourceId })}
      />
      <OptionSelect
        id={`${idPrefix}-status`}
        label={t('crm.field.status')}
        value={value.statusId}
        options={opts(lookups.statuses)}
        onChange={(statusId) => set({ statusId })}
      />
      <OptionSelect
        id={`${idPrefix}-sales`}
        label={t('crm.field.sales')}
        value={value.salesUserId}
        options={members}
        onChange={(salesUserId) => set({ salesUserId })}
      />
      <OptionSelect
        id={`${idPrefix}-care`}
        label={t('crm.field.care')}
        value={value.careUserId}
        options={members}
        onChange={(careUserId) => set({ careUserId })}
      />
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-profileNote`}>{t('crm.field.profileNote')}</Label>
        <Textarea
          id={`${idPrefix}-profileNote`}
          rows={2}
          maxLength={500}
          value={value.profileNote}
          onChange={(e) => set({ profileNote: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">{t('crm.field.profileNoteHint')}</p>
      </div>
    </div>
  );
}
