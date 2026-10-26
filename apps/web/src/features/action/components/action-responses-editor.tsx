import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import {
  emptyField,
  emptyResponse,
  type FieldError,
  type FieldRow,
  type ResponseRow,
} from '../lib/action-form';
import { Field, OptionSelect, useErrorText } from './action-fields';

const FIELD_TYPES = ['string', 'number', 'boolean', 'object', 'array'] as const;

/** Repeatable "Responses": a status code and the fields the bot may read from that response. */
export function ResponsesEditor({
  rows,
  errors,
  onChange,
}: {
  rows: ResponseRow[];
  errors: Record<string, FieldError>;
  onChange: (rows: ResponseRow[]) => void;
}) {
  const { t } = useTranslation('action');
  const errorText = useErrorText(errors);
  const update = (i: number, patch: Partial<ResponseRow>) =>
    onChange(rows.map((r, at) => (at === i ? { ...r, ...patch } : r)));
  const updateField = (i: number, j: number, patch: Partial<FieldRow>) =>
    update(i, {
      fields: (rows[i]?.fields ?? []).map((f, at) => (at === j ? { ...f, ...patch } : f)),
    });

  return (
    <section aria-labelledby="action-responses" className="flex flex-col gap-3">
      <div>
        <h2 id="action-responses" className="text-sm font-semibold">
          {t('form.responses')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('form.responsesHint')}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {rows.map((row, i) => {
          const n = i + 1;
          return (
            <li key={row.key} className="flex flex-col gap-3 rounded-lg border p-3">
              <div className="flex items-end gap-2">
                <Field
                  id={`resp-code-${row.key}`}
                  label={`${t('form.statusCode')} ${n}`}
                  error={errorText(`responses.${i}.statusCode`)}
                  className="w-40"
                >
                  <Input
                    id={`resp-code-${row.key}`}
                    inputMode="numeric"
                    value={row.statusCode}
                    aria-invalid={Boolean(errors[`responses.${i}.statusCode`])}
                    onChange={(e) => update(i, { statusCode: e.target.value })}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto"
                  aria-label={t('form.removeResponse', { n })}
                  onClick={() => onChange(rows.filter((_, at) => at !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
              <ul className="flex flex-col gap-2">
                {row.fields.map((field, j) => {
                  const m = `${n}.${j + 1}`;
                  const base = `responses.${i}.fields.${j}`;
                  return (
                    <li
                      key={field.key}
                      className="grid items-start gap-2 sm:grid-cols-[1fr_8rem_1.5fr_auto]"
                    >
                      <Field
                        id={`field-name-${field.key}`}
                        label={`${t('form.fieldName')} ${m}`}
                        error={errorText(`${base}.name`)}
                      >
                        <Input
                          id={`field-name-${field.key}`}
                          value={field.name}
                          aria-invalid={Boolean(errors[`${base}.name`])}
                          onChange={(e) => updateField(i, j, { name: e.target.value })}
                        />
                      </Field>
                      <div className="flex flex-col gap-1.5">
                        <Label>{`${t('form.fieldType')} ${m}`}</Label>
                        <OptionSelect
                          label={`${t('form.fieldType')} ${m}`}
                          value={field.type}
                          options={FIELD_TYPES.map((v) => ({
                            value: v,
                            label: t(`form.fieldTypes.${v}`),
                          }))}
                          onChange={(type) => updateField(i, j, { type })}
                        />
                      </div>
                      <Field
                        id={`field-desc-${field.key}`}
                        label={`${t('form.fieldDescription')} ${m}`}
                        error={errorText(`${base}.description`)}
                      >
                        <Input
                          id={`field-desc-${field.key}`}
                          value={field.description}
                          aria-invalid={Boolean(errors[`${base}.description`])}
                          onChange={(e) => updateField(i, j, { description: e.target.value })}
                        />
                      </Field>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="mt-6"
                        aria-label={t('form.removeField', { n: m })}
                        onClick={() =>
                          update(i, { fields: row.fields.filter((_, at) => at !== j) })
                        }
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  );
                })}
              </ul>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                aria-label={`${t('form.addField')} ${n}`}
                onClick={() => update(i, { fields: [...row.fields, emptyField()] })}
              >
                <Plus />
                {t('form.addField')}
              </Button>
            </li>
          );
        })}
      </ul>
      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => onChange([...rows, emptyResponse()])}
      >
        <Plus />
        {t('form.addResponse')}
      </Button>
    </section>
  );
}
