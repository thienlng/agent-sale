import { describe, expect, it } from 'vitest';

import { runChecks } from '../evals/checks.js';
import { loadCases } from '../evals/load.js';

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

  it('max_occurrences caps how often a text appears in the reply', () => {
    const reply = 'Dạ anh/chị xem mẫu này nhé.\nAnh/chị cần size nào ạ?';
    expect(runChecks({ max_occurrences: { 'anh/chị': 1 } }, { ...base, reply })[0]).toMatchObject({
      name: 'max_occurrences',
      pass: false,
    });
    expect(runChecks({ max_occurrences: { 'anh/chị': 2 } }, { ...base, reply })[0]?.pass).toBe(
      true,
    );
    expect(runChecks({ max_occurrences: { 'anh/chị': 0 } }, base)[0]?.pass).toBe(true);
  });

  it('messages_min, image_messages_min and images_per_message_max read the delivered messages', () => {
    const messages = [
      { text: 'Thú gỗ xếp thăng bằng', images: 3 },
      { text: 'Xương rồng gỗ', images: 1 },
      { text: 'Dạ bé thích mẫu nào ạ?', images: 0 },
    ];
    const input = { ...base, messages, images: 4 };
    const passing = runChecks(
      { messages_min: 3, image_messages_min: 2, images_per_message_max: 3, images_min: 4 },
      input,
    );
    expect(passing.map((c) => [c.name, c.pass])).toEqual([
      ['images_min', true],
      ['messages_min', true],
      ['image_messages_min', true],
      ['images_per_message_max', true],
    ]);
    const failing = runChecks(
      { messages_min: 4, image_messages_min: 3, images_per_message_max: 2 },
      input,
    );
    expect(failing.filter((c) => !c.pass).map((c) => c.name)).toEqual([
      'messages_min',
      'image_messages_min',
      'images_per_message_max',
    ]);
    expect(failing.find((c) => c.name === 'images_per_message_max')?.detail).toContain('3');
  });

  it('counts no delivered messages when the input has none', () => {
    expect(runChecks({ messages_min: 1 }, base)[0]).toMatchObject({
      name: 'messages_min',
      pass: false,
    });
    expect(runChecks({ images_per_message_max: 0 }, base)[0]?.pass).toBe(true);
  });

  it('checks the tools the turn ran and which of them succeeded', () => {
    const steps = [
      { name: 'search_products', ok: true },
      { name: 'prepare_order', ok: false },
      { name: 'calculate', ok: true },
    ];
    const input = { ...base, steps };
    const passing = runChecks(
      {
        steps_include: ['prepare_order', 'calculate'],
        steps_exclude: ['confirm_order'],
        steps_succeeded: ['calculate'],
        steps_not_succeeded: ['prepare_order', 'confirm_order'],
      },
      input,
    );
    expect(passing.map((c) => [c.name, c.pass])).toEqual([
      ['steps_include', true],
      ['steps_exclude', true],
      ['steps_succeeded', true],
      ['steps_not_succeeded', true],
    ]);
    const failing = runChecks(
      {
        steps_include: ['confirm_order'],
        steps_exclude: ['prepare_order'],
        steps_succeeded: ['prepare_order'],
        steps_not_succeeded: ['calculate'],
      },
      input,
    );
    expect(failing.filter((c) => !c.pass)).toHaveLength(4);
    expect(failing[0]?.detail).toContain('prepare_order (failed)');
    expect(runChecks({ steps_include: ['calculate'] }, base)[0]?.detail).toContain('none');
  });

  it('checks the quick replies of a delivered message and whether an order was created', () => {
    const messages = [
      { text: 'Dạ em tóm tắt đơn của mình ạ:', images: 0, quickReplies: ['✅ Đặt hàng', '✏️ Sửa'] },
      { text: 'Dạ mình kiểm tra giúp em ạ.', images: 0 },
    ];
    const input = { ...base, messages, orderCreated: false };
    expect(
      runChecks({ quick_replies: ['✅ Đặt hàng', '✏️ Sửa'], order_created: false }, input).every(
        (c) => c.pass,
      ),
    ).toBe(true);
    const failing = runChecks({ quick_replies: ['✅ Đặt hàng'], order_created: true }, input);
    expect(failing.map((c) => [c.name, c.pass])).toEqual([
      ['quick_replies', false],
      ['order_created', false],
    ]);
    expect(runChecks({ order_created: false }, base)[0]?.pass).toBe(true);
  });

  it('the "ktra xong chưa" patterns reject a promise to check but not a past-tense answer', () => {
    const c = loadCases().find((x) => x.id === 'tinymind-check-follow-up-no-promise');
    const expectation = { not_matches: c?.expect.not_matches };
    expect(expectation.not_matches?.length).toBeGreaterThan(0);
    for (const promise of [
      'Dạ để em kiểm tra lại rồi báo anh/chị ngay ạ.',
      'Dạ em sẽ xem lại kho rồi báo ạ.',
      'Dạ em kiểm tra lại rồi báo anh/chị nhé.',
    ])
      expect(runChecks(expectation, { ...base, reply: promise })[0]?.pass, promise).toBe(false);
    for (const answer of [
      'Dạ em đã kiểm tra rồi ạ, mẫu này còn hàng, giá 460.000đ ạ.',
      'Dạ Xương rồng gỗ xếp thăng bằng phù hợp bé từ 2 tuổi trở lên, còn hàng ạ.',
    ])
      expect(runChecks(expectation, { ...base, reply: answer })[0]?.pass, answer).toBe(true);
  });
});
