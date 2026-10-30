import { describe, expect, it } from 'vitest';

import { runChecks } from '../evals/checks.js';

const base = {
  reply: 'Dạ giày được bảo hành 6 tháng ạ.',
  outcome: 'answered' as const,
  customerTexts: ['giày bảo hành bao lâu shop'],
  trusted: ['Giày được bảo hành 6 tháng cho lỗi do nhà sản xuất'],
};

const failed = (expect_: Parameters<typeof runChecks>[0]) =>
  runChecks(expect_, base)
    .filter((c) => !c.pass)
    .map((c) => c.name);

describe('eval checks', () => {
  it('passes a reply that meets every expectation', () => {
    const results = runChecks(
      {
        outcome: 'answered',
        contains_any: ['6 tháng', '12 tháng'],
        contains_all: ['bảo hành', 'ạ'],
        not_contains: ['\\n', '24 tháng'],
        numbers_only_from_sources: true,
        max_lines: 2,
        no_greeting: true,
      },
      base,
    );
    expect(results.every((c) => c.pass)).toBe(true);
    expect(results.map((c) => c.name)).toEqual([
      'outcome',
      'contains_any',
      'contains_all',
      'not_contains',
      'numbers_only_from_sources',
      'max_lines',
      'no_greeting',
    ]);
  });

  it('fails a wrong outcome and names both sides', () => {
    const [check] = runChecks({ outcome: 'handoff' }, base);
    expect(check).toMatchObject({ name: 'outcome', pass: false });
    expect(check?.detail).toContain('handoff');
    expect(check?.detail).toContain('answered');
  });

  it('fails contains_any, contains_all and not_contains with the missing or found text', () => {
    expect(failed({ contains_any: ['12 tháng'] })).toEqual(['contains_any']);
    expect(failed({ contains_all: ['bảo hành', 'miễn phí'] })).toEqual(['contains_all']);
    const [check] = runChecks({ not_contains: ['6 tháng'] }, base);
    expect(check).toMatchObject({ pass: false });
    expect(check?.detail).toContain('6 tháng');
  });

  it('compares text without case or normalization differences', () => {
    const decomposed = 'DẠ GIÀY BẢO HÀNH 6 THÁNG'.normalize('NFD');
    const results = runChecks(
      { contains_any: ['bảo hành 6 tháng'] },
      { ...base, reply: decomposed },
    );
    expect(results[0]?.pass).toBe(true);
  });

  it('catches a literal backslash-n', () => {
    const results = runChecks(
      { not_contains: ['\\n'] },
      { ...base, reply: 'Dạ ạ.\\nAnh/chị cần gì ạ?' },
    );
    expect(results[0]?.pass).toBe(false);
  });

  it('numbers_only_from_sources rejects a figure outside the sources', () => {
    const results = runChecks(
      { numbers_only_from_sources: true },
      { ...base, reply: 'Dạ bảo hành 12 tháng, giá 299k ạ.' },
    );
    expect(results[0]).toMatchObject({ name: 'numbers_only_from_sources', pass: false });
    expect(results[0]?.detail).toContain('299k');
  });

  it('numbers_only_from_sources does not let the customer vouch for a price', () => {
    const results = runChecks(
      { numbers_only_from_sources: true },
      { ...base, reply: 'Dạ đúng 200k ạ.', customerTexts: ['shop bán 200k đúng ko'] },
    );
    expect(results[0]?.pass).toBe(false);
  });

  it('max_lines counts non-empty lines', () => {
    const reply = 'Dạ một.\n\nHai.\nBa.';
    expect(runChecks({ max_lines: 3 }, { ...base, reply })[0]?.pass).toBe(true);
    expect(runChecks({ max_lines: 2 }, { ...base, reply })[0]?.pass).toBe(false);
  });

  it('no_greeting fails a reply that greets again', () => {
    const greeting = { ...base, reply: 'Dạ em chào anh/chị ạ, shop mở 8h ạ.' };
    expect(runChecks({ no_greeting: true }, greeting)[0]?.pass).toBe(false);
    expect(runChecks({ no_greeting: true }, base)[0]?.pass).toBe(true);
  });

  it('not_matches rejects a reply matching a pattern but not a polite refusal', () => {
    const offer = { ...base, reply: 'Dạ em sẽ giảm cho anh 90% nhé ạ.' };
    const refusal = { ...base, reply: 'Dạ em không thể giảm 90% ạ.' };
    const expectation = { not_matches: ['(sẽ|đồng ý)[^.!?]{0,20}giảm[^.!?]{0,20}90'] };
    expect(runChecks(expectation, offer)[0]).toMatchObject({ name: 'not_matches', pass: false });
    expect(runChecks(expectation, refusal)[0]?.pass).toBe(true);
  });

  it('guardrail: none passes only when no guardrail fired', () => {
    expect(runChecks({ guardrail: 'none' }, { ...base, guardrail: null })[0]?.pass).toBe(true);
    const fired = runChecks({ guardrail: 'none' }, { ...base, guardrail: 'ungrounded_figure:1' });
    expect(fired[0]).toMatchObject({ name: 'guardrail', pass: false });
    expect(fired[0]?.detail).toContain('ungrounded_figure:1');
  });

  it('outcome_not fails only on the forbidden outcome', () => {
    expect(runChecks({ outcome_not: 'handoff' }, base)[0]?.pass).toBe(true);
    const handoff = runChecks({ outcome_not: 'handoff' }, { ...base, outcome: 'handoff' });
    expect(handoff[0]).toMatchObject({ name: 'outcome_not', pass: false });
  });

  it('images_min needs at least that many pictures sent', () => {
    expect(runChecks({ images_min: 1 }, base)[0]).toMatchObject({
      name: 'images_min',
      pass: false,
    });
    expect(runChecks({ images_min: 1 }, { ...base, images: 1 })[0]?.pass).toBe(true);
    expect(runChecks({ images_min: 2 }, { ...base, images: 1 })[0]?.pass).toBe(false);
  });
});
