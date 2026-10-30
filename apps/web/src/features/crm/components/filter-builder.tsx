import {
  CONTACT_FILTER_FIELDS,
  type ContactFilter,
  type ContactFilterField,
  ContactFilterRule,
  FILTER_OPERATORS,
} from '@agent-sales/contracts';
import { Check, ChevronDown, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

import type { CrmLookups } from '../hooks/use-crm-lookups';

type Rule = ContactFilter['rules'][number];
const FIELDS = Object.keys(CONTACT_FILTER_FIELDS) as ContactFilterField[];
const NO_VALUE = new Set(['is_set', 'is_empty']);

export const EMPTY_FILTER: ContactFilter = { v: 1, match: 'all', rules: [], duplicatesOnly: false };

/** Field names as on the customer form (dates and tags as in the list). */
const FIELD_LABELS: Record<ContactFilterField, string> = {
  name: 'crm.field.name',
  phone: 'crm.field.phone',
  email: 'crm.field.email',
  address: 'crm.field.address',
  profileNote: 'crm.field.profileNote',
  adRef: 'crm.field.adRef',
  gender: 'crm.field.gender',
  sourceId: 'crm.field.source',
  statusId: 'crm.field.status',
  salesUserId: 'crm.field.sales',
  careUserId: 'crm.field.care',
  tagId: 'crm.filter.field.tagId',
  botId: 'crm.filter.field.botId',
  createdAt: 'crm.col.createdAt',
  updatedAt: 'crm.col.updatedAt',
  birthday: 'crm.field.birthday',
};

export const fieldLabel = (f: ContactFilterField) => FIELD_LABELS[f];

function choicesFor(field: ContactFilterField, lookups: CrmLookups, t: (k: string) => string) {
  switch (field) {
    case 'sourceId':
      return lookups.sources.map((o) => ({ id: o.id, label: o.name, muted: o.archived }));
    case 'statusId':
      return lookups.statuses.map((o) => ({ id: o.id, label: o.name, muted: o.archived }));
    case 'salesUserId':
    case 'careUserId':
      return lookups.assignees.map((m) => ({ id: m.userId, label: m.name, muted: false }));
    case 'tagId':
      return lookups.tags.map((tag) => ({ id: tag.id, label: tag.name, muted: tag.archived }));
    case 'botId':
      return lookups.bots.map((bot) => ({ id: bot.id, label: bot.name, muted: false }));
    case 'gender':
      return (['male', 'female', 'other'] as const).map((g) => ({
        id: g,
        label: t(`crm.field.genders.${g}`),
        muted: false,
      }));
    default:
      return [];
  }
}

/** Choose several ids from a searchable list (sources, statuses, members, tags, bots, genders). */
function MultiPicker({
  choices,
  value,
  onChange,
  label,
}: {
  choices: Array<{ id: string; label: string; muted: boolean }>;
  value: string[];
  onChange: (v: string[]) => void;
  label: string;
}) {
  const { t } = useTranslation();
  const chosen = new Set(value);
  const names = choices.filter((c) => chosen.has(c.id)).map((c) => c.label);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-9 w-full justify-between font-normal"
          aria-label={label}
        >
          <span className="truncate">
            {names.length === 0
              ? t('crm.filter.choose')
              : names.length <= 2
                ? names.join(', ')
                : t('crm.filter.chosen', { count: names.length })}
          </span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={t('crm.filter.choose')} />
          <CommandList>
            <CommandEmpty>—</CommandEmpty>
            <CommandGroup>
              {choices.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.label} ${c.id}`}
                  onSelect={() =>
                    onChange(chosen.has(c.id) ? value.filter((x) => x !== c.id) : [...value, c.id])
                  }
                >
                  <Check className={cn('size-4', chosen.has(c.id) ? 'opacity-100' : 'opacity-0')} />
                  <span className={cn('truncate', c.muted && 'text-muted-foreground')}>
                    {c.label}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function RuleRow({
  rule,
  index,
  lookups,
  onChange,
  onRemove,
}: {
  rule: Rule;
  index: number;
  lookups: CrmLookups;
  onChange: (r: Rule) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const kind = CONTACT_FILTER_FIELDS[rule.field];
  const ops: readonly string[] = FILTER_OPERATORS[kind];
  const valid = ContactFilterRule.safeParse(rule).success;
  const valueLabel = `${t('crm.filter.value')} ${index + 1}`;

  const setField = (field: ContactFilterField) => {
    const nextKind = CONTACT_FILTER_FIELDS[field];
    onChange({ field, op: FILTER_OPERATORS[nextKind][0], value: undefined });
  };

  let editor = null;
  if (!NO_VALUE.has(rule.op)) {
    if (kind === 'text') {
      editor = (
        <Input
          aria-label={valueLabel}
          className="h-9"
          maxLength={200}
          value={typeof rule.value === 'string' ? rule.value : ''}
          onChange={(e) => onChange({ ...rule, value: e.target.value })}
        />
      );
    } else if (kind === 'date') {
      const range =
        typeof rule.value === 'object' && rule.value && !Array.isArray(rule.value)
          ? rule.value
          : { from: '', to: '' };
      editor =
        rule.op === 'between' ? (
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              aria-label={`${valueLabel} ${t('crm.filter.from')}`}
              className="h-9"
              value={range.from}
              onChange={(e) => onChange({ ...rule, value: { from: e.target.value, to: range.to } })}
            />
            <Input
              type="date"
              aria-label={`${valueLabel} ${t('crm.filter.to')}`}
              className="h-9"
              value={range.to}
              onChange={(e) =>
                onChange({ ...rule, value: { from: range.from, to: e.target.value } })
              }
            />
          </div>
        ) : (
          <Input
            type="date"
            aria-label={valueLabel}
            className="h-9"
            value={typeof rule.value === 'string' ? rule.value : ''}
            onChange={(e) => onChange({ ...rule, value: e.target.value })}
          />
        );
    } else {
      editor = (
        <MultiPicker
          label={valueLabel}
          choices={choicesFor(rule.field, lookups, t)}
          value={Array.isArray(rule.value) ? rule.value : []}
          onChange={(value) => onChange({ ...rule, value })}
        />
      );
    }
  }

  return (
    <li
      className={cn(
        'grid gap-2 rounded-lg border p-2 sm:grid-cols-[10rem_9rem_minmax(0,1fr)_auto] sm:items-center',
        !valid && 'border-destructive/50',
      )}
    >
      <Select value={rule.field} onValueChange={(v) => setField(v as ContactFilterField)}>
        <SelectTrigger
          className="h-9 w-full"
          aria-label={`${t('crm.filter.fieldLabel')} ${index + 1}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FIELDS.map((f) => (
            <SelectItem key={f} value={f}>
              {t(fieldLabel(f))}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={rule.op}
        onValueChange={(op) =>
          onChange({
            ...rule,
            op,
            value: op === 'between' || rule.op === 'between' ? undefined : rule.value,
          })
        }
      >
        <SelectTrigger
          className="h-9 w-full"
          aria-label={`${t('crm.filter.operator')} ${index + 1}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ops.map((op) => (
            <SelectItem key={op} value={op}>
              {t(`crm.filter.op.${op}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="min-w-0">{editor}</div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t('crm.filter.removeRule')}
        onClick={onRemove}
      >
        <X />
      </Button>
    </li>
  );
}

/**
 * The customer filter: rules joined by All (AND) or Any (OR), plus the duplicate
 * phone switch. Edits stay a draft until Apply; invalid rules block Apply.
 */
export function FilterBuilder({
  initial,
  lookups,
  onApply,
  onSaveView,
}: {
  initial: ContactFilter;
  lookups: CrmLookups;
  onApply: (f: ContactFilter) => void;
  onSaveView: (f: ContactFilter) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ContactFilter>(initial);
  const valid = draft.rules.every((r) => ContactFilterRule.safeParse(r).success);
  const setRule = (i: number, r: Rule) =>
    setDraft({ ...draft, rules: draft.rules.map((x, idx) => (idx === i ? r : x)) });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{t('crm.filter.title')}</h2>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={draft.match}
          onValueChange={(v) => v && setDraft({ ...draft, match: v as 'all' | 'any' })}
        >
          <ToggleGroupItem value="all">{t('crm.filter.matchAll')}</ToggleGroupItem>
          <ToggleGroupItem value="any">{t('crm.filter.matchAny')}</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {draft.rules.length ? (
        <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
          {draft.rules.map((r, i) => (
            <RuleRow
              key={i}
              index={i}
              rule={r}
              lookups={lookups}
              onChange={(next) => setRule(i, next)}
              onRemove={() =>
                setDraft({ ...draft, rules: draft.rules.filter((_, idx) => idx !== i) })
              }
            />
          ))}
        </ul>
      ) : null}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={draft.rules.length >= 20}
          onClick={() =>
            setDraft({
              ...draft,
              rules: [...draft.rules, { field: 'name', op: 'contains', value: '' }],
            })
          }
        >
          <Plus />
          {t('crm.filter.addRule')}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id="crm-duplicates"
          checked={draft.duplicatesOnly}
          onCheckedChange={(c) => setDraft({ ...draft, duplicatesOnly: c })}
        />
        <Label htmlFor="crm-duplicates" className="font-normal">
          {t('crm.filter.duplicates')}
        </Label>
      </div>
      {!valid ? <p className="text-xs text-destructive">{t('crm.filter.invalid')}</p> : null}
      <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
        <Button type="button" variant="ghost" onClick={() => onApply(EMPTY_FILTER)}>
          {t('crm.filter.clear')}
        </Button>
        <Button type="button" variant="outline" disabled={!valid} onClick={() => onSaveView(draft)}>
          {t('crm.filter.saveView')}
        </Button>
        <Button type="button" disabled={!valid} onClick={() => onApply(draft)}>
          {t('crm.filter.apply')}
        </Button>
      </div>
    </div>
  );
}
