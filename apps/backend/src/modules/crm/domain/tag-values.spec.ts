import { describe, expect, it } from 'vitest';

import { type TagField, validateTagValues } from './tag-values.js';

const f = (over: Partial<TagField> & Pick<TagField, 'key' | 'type'>): TagField => ({
  label: over.key,
  required: false,
  options: [],
  archived: false,
  ...over,
});

const fields: TagField[] = [
  f({ key: 'subject', type: 'text', required: true }),
  f({ key: 'amount', type: 'number' }),
  f({ key: 'paid', type: 'boolean' }),
  f({ key: 'due', type: 'date' }),
  f({
    key: 'level',
    type: 'select',
    options: [
      { id: 'gold', label: 'Vàng', archived: false },
      { id: 'old', label: 'Cũ', archived: true },
    ],
  }),
  f({ key: 'gone', type: 'text', archived: true }),
];

describe('validateTagValues', () => {
  it('accepts typed values and drops unknown keys and blanks', () => {
    const r = validateTagValues(fields, {
      subject: ' Đổi size ',
      amount: 2,
      paid: false,
      due: '2026-11-01',
      level: 'gold',
      extra: 'x',
      gone: 'y',
    });
    expect(r).toEqual({
      ok: true,
      values: { subject: 'Đổi size', amount: 2, paid: false, due: '2026-11-01', level: 'gold' },
    });
  });

  it('reports missing required and wrong-type values per field', () => {
    const r = validateTagValues(fields, { amount: '2', due: '01/11/2026', level: 'nope' });
    expect(r).toEqual({
      ok: false,
      errors: { subject: 'required', amount: 'number', due: 'date', level: 'option' },
    });
  });

  it('keeps an archived option or field that was already set, but not a new one', () => {
    expect(validateTagValues(fields, { subject: 'a', level: 'old' }).ok).toBe(false);
    expect(
      validateTagValues(fields, { subject: 'a', level: 'old' }, { level: 'old', gone: 'kept' }),
    ).toEqual({ ok: true, values: { subject: 'a', level: 'old', gone: 'kept' } });
  });
});
