/** A field of a tag's attribute schema (mirrors TagFieldDef in contracts). */
export interface TagField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'boolean';
  required: boolean;
  options: Array<{ id: string; label: string; archived: boolean }>;
  archived: boolean;
}

type Value = string | number | boolean | null;

/**
 * Checks values against a tag's fields. Returns the cleaned values (unknown keys
 * and archived fields dropped, blanks removed) or the errors per field key.
 * `previous` keeps an archived select option that was already chosen readable.
 */
export function validateTagValues(
  fields: readonly TagField[],
  values: Record<string, Value>,
  previous: Record<string, unknown> = {},
): { ok: true; values: Record<string, Value> } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const out: Record<string, Value> = {};
  for (const f of fields) {
    if (f.archived) {
      if (previous[f.key] !== undefined) out[f.key] = previous[f.key] as Value;
      continue;
    }
    const v = values[f.key];
    const blank = v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    if (blank) {
      if (f.required) errors[f.key] = 'required';
      continue;
    }
    switch (f.type) {
      case 'text':
        if (typeof v !== 'string' || v.length > 500) errors[f.key] = 'text';
        else out[f.key] = v.trim();
        break;
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) errors[f.key] = 'number';
        else out[f.key] = v;
        break;
      case 'boolean':
        if (typeof v !== 'boolean') errors[f.key] = 'boolean';
        else out[f.key] = v;
        break;
      case 'date':
        if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))
          errors[f.key] = 'date';
        else out[f.key] = v;
        break;
      case 'select': {
        const option = f.options.find((o) => o.id === v);
        const kept = option?.archived && previous[f.key] === v;
        if (!option || (option.archived && !kept)) errors[f.key] = 'option';
        else out[f.key] = v;
        break;
      }
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, values: out };
}
