import type { Policies, PropertyDto } from '@agent-sales/contracts';
import { type FormEvent, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { useUpdateProperty } from '../api/properties';
import { useSaveError } from '../hooks/use-save-error';
import { Field, TabSaveBar, useReportDirty, useTabDraft } from './property-tab-parts';

const TIMES = ['checkInTime', 'checkOutTime'] as const;
/** Half-hour slots, 24-hour "HH:mm": one format for the owner, the calendar and the bot. */
const SLOTS = Array.from(
  { length: 48 },
  (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`,
);
const NONE = 'none';
const LONG = [
  ['deposit', 1000],
  ['cancellation', 1000],
  ['houseRules', 2000],
  ['other', 2000],
] as const;

/** "Chính sách" tab: free-text policies; an empty field means "unknown", never "none". */
export function PoliciesTab({
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
  const base = useMemo<Policies>(() => ({ ...p.policies }), [p]);
  const { draft, setDraft, dirty, discard } = useTabDraft(base);
  useReportDirty(dirty, onDirtyChange);
  const update = useUpdateProperty();
  const saveError = useSaveError();
  const set = (key: keyof Policies, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (update.isPending || !canEdit) return;
    const policies = Object.fromEntries(
      Object.entries(draft).map(([k, v]) => [k, v.trim()]),
    ) as Policies;
    update.mutate(
      { id: p.id, body: { version: p.version, patch: { policies } } },
      {
        onSuccess: (saved) => {
          setDraft({ ...saved.policies });
          toast.success(t('lodging.editor.saved'), { duration: 3500 });
        },
        onError: (error) => saveError(error, { onStale: discard }),
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="grid max-w-3xl gap-4">
      <p className="text-sm text-muted-foreground">{t('lodging.policies.hint')}</p>
      <div className="flex flex-wrap gap-4">
        {TIMES.map((key) => {
          const value = draft[key].trim();
          // Older free-text values ("sau 14h") stay selectable until the owner picks a slot.
          const options = value && !SLOTS.includes(value) ? [value, ...SLOTS] : SLOTS;
          return (
            <Field key={key} id={`${id}-${key}`} label={t(`lodging.policies.${key}`)}>
              <Select
                value={value || NONE}
                disabled={!canEdit}
                onValueChange={(v) => set(key, v === NONE ? '' : v)}
              >
                <SelectTrigger id={`${id}-${key}`} className="w-40 tabular-nums">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={NONE}>{t('lodging.policies.timeUnset')}</SelectItem>
                  {options.map((slot) => (
                    <SelectItem key={slot} value={slot} className="tabular-nums">
                      {slot}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          );
        })}
      </div>
      {LONG.map(([key, max]) => (
        <Field key={key} id={`${id}-${key}`} label={t(`lodging.policies.${key}`)}>
          <Textarea
            id={`${id}-${key}`}
            rows={3}
            value={draft[key]}
            maxLength={max}
            disabled={!canEdit}
            onChange={(e) => set(key, e.target.value)}
          />
        </Field>
      ))}
      <TabSaveBar
        dirty={dirty}
        pending={update.isPending}
        canEdit={canEdit}
        label={t('lodging.policies.save')}
      />
    </form>
  );
}
