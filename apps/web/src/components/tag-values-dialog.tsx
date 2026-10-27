import type { TagDto, TagValues } from '@agent-sales/contracts';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const NONE = '__none';

/** The values form of an attribute tag (fields from the tag's schema). */
export function TagValuesDialog({
  tag,
  initial,
  onSave,
  onClose,
  pending,
  error,
}: {
  tag: TagDto;
  initial: TagValues;
  onSave: (values: TagValues) => void;
  onClose: () => void;
  pending: boolean;
  error?: string | undefined;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<TagValues>(() => ({
    ...Object.fromEntries(
      tag.fields.filter((f) => !f.archived && f.type === 'boolean').map((f) => [f.key, false]),
    ),
    ...initial,
  }));
  const fields = tag.fields.filter((f) => !f.archived);
  const set = (key: string, v: TagValues[string]) => setValues({ ...values, [key]: v });
  const [validation, setValidation] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const missing = fields.filter(
      (f) =>
        f.required &&
        (values[f.key] === undefined ||
          values[f.key] === null ||
          (typeof values[f.key] === 'string' && !String(values[f.key]).trim())),
    );
    if (missing.length) {
      setValidation(
        t('crm.errors.fieldsInvalid', { fields: missing.map((f) => f.label).join(', ') }),
      );
      return;
    }
    setValidation(null);
    if (!pending) onSave(values);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('crm.detail.tagValues', { name: tag.name })}</DialogTitle>
          </DialogHeader>
          {fields.map((f) => {
            const id = `tv-${f.key}`;
            const v = values[f.key];
            const label = `${f.label}${f.required ? ' *' : ''}`;
            if (f.type === 'boolean') {
              return (
                <label key={f.key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    disabled={pending}
                    checked={v === true}
                    onCheckedChange={(c) => set(f.key, c === true)}
                  />
                  {label}
                </label>
              );
            }
            return (
              <div key={f.key} className="flex flex-col gap-1.5">
                <Label htmlFor={id}>{label}</Label>
                {f.type === 'select' ? (
                  <Select
                    required={f.required}
                    disabled={pending}
                    value={typeof v === 'string' && v ? v : NONE}
                    onValueChange={(x) => set(f.key, x === NONE ? null : x)}
                  >
                    <SelectTrigger id={id} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t('crm.field.none')}</SelectItem>
                      {f.options
                        .filter((o) => !o.archived || o.id === v)
                        .map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={id}
                    type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                    required={f.required}
                    disabled={pending}
                    step={f.type === 'number' ? 'any' : undefined}
                    value={v === null || v === undefined ? '' : String(v)}
                    onChange={(e) =>
                      set(
                        f.key,
                        f.type === 'number'
                          ? e.target.value === ''
                            ? null
                            : Number(e.target.value)
                          : e.target.value,
                      )
                    }
                  />
                )}
              </div>
            );
          })}
          {error || validation ? (
            <p role="alert" className="text-sm text-destructive">
              {error ?? validation}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {t('crm.detail.saveTag')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
