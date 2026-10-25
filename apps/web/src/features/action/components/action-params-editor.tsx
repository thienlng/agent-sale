import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { emptyParam, type FieldError, type ParamRow } from '../lib/action-form';
import { Field, OptionSelect, useErrorText } from './action-fields';

const TYPES = ['string', 'number', 'boolean'] as const;
const LOCATIONS = ['path', 'query', 'header', 'body'] as const;

/** Repeatable "Parameters" rows: what the bot must collect before it calls the API. */
export function ParamsEditor({
  rows,
  errors,
  onChange,
}: {
  rows: ParamRow[];
  errors: Record<string, FieldError>;
  onChange: (rows: ParamRow[]) => void;
}) {
  const { t } = useTranslation('action');
  const errorText = useErrorText(errors);
  const update = (i: number, patch: Partial<ParamRow>) =>
    onChange(rows.map((r, at) => (at === i ? { ...r, ...patch } : r)));

  return (
    <section aria-labelledby="action-params" className="flex flex-col gap-3">
      <div>
        <h2 id="action-params" className="text-sm font-semibold">
          {t('form.params')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('form.paramsHint')}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {rows.map((row, i) => {
          const n = i + 1;
          return (
            <li key={row.key} className="flex flex-col gap-3 rounded-lg border p-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_9rem_9rem]">
                <Field
                  id={`param-name-${row.key}`}
                  label={`${t('form.paramName')} ${n}`}
                  error={errorText(`params.${i}.name`)}
                >
                  <Input
                    id={`param-name-${row.key}`}
                    value={row.name}
                    aria-invalid={Boolean(errors[`params.${i}.name`])}
                    onChange={(e) => update(i, { name: e.target.value })}
                  />
                </Field>
                <div className="flex flex-col gap-1.5">
                  <Label>{`${t('form.paramType')} ${n}`}</Label>
                  <OptionSelect
                    label={`${t('form.paramType')} ${n}`}
                    value={row.type}
                    options={TYPES.map((v) => ({ value: v, label: t(`form.types.${v}`) }))}
                    onChange={(type) => update(i, { type })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{`${t('form.paramLocation')} ${n}`}</Label>
                  <OptionSelect
                    label={`${t('form.paramLocation')} ${n}`}
                    value={row.location}
                    options={LOCATIONS.map((v) => ({ value: v, label: t(`form.locations.${v}`) }))}
                    onChange={(location) => update(i, { location })}
                  />
                </div>
              </div>
              <Field
                id={`param-desc-${row.key}`}
                label={`${t('form.paramDescription')} ${n}`}
                error={errorText(`params.${i}.description`)}
              >
                <Input
                  id={`param-desc-${row.key}`}
                  value={row.description}
                  aria-invalid={Boolean(errors[`params.${i}.description`])}
                  onChange={(e) => update(i, { description: e.target.value })}
                />
              </Field>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`param-req-${row.key}`}
                    checked={row.required}
                    onCheckedChange={(v) => update(i, { required: v === true })}
                  />
                  <Label htmlFor={`param-req-${row.key}`} className="font-normal">
                    {`${t('form.paramRequired')} ${n}`}
                  </Label>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('form.removeParam', { n })}
                  onClick={() => onChange(rows.filter((_, at) => at !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => onChange([...rows, emptyParam()])}
      >
        <Plus />
        {t('form.addParam')}
      </Button>
    </section>
  );
}
