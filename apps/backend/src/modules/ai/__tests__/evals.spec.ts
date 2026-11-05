import { FakeLlmProvider, type GenerateRequest } from '@agent-sales/ai-core';
import { newId, workspaceId } from '@agent-sales/shared';
import type { ProductDto } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import { LlmRuntime } from '../application/llm-runtime.js';
import { InMemoryLlmConfigRepository } from '../infrastructure/persistence/llm-config.in-memory-repository.js';
import { loadCases, parseCase } from '../evals/load.js';
import { buildReport, renderMarkdown, renderText } from '../evals/report.js';
import { dateLabel, evalRequests, isPastDate } from '../evals/requests.js';
import { evalCatalog, fakeRuntime, fakeScript, runCase, runCaseFake } from '../evals/runner.js';
import { runChecks } from '../evals/checks.js';
import { evalLodging } from '../evals/lodging.js';

const cases = loadCases();

const MINIMAL = `
id: sample
group: g
bot: { profile: { fields: { warranty: "Bảo hành 6 tháng" }, notes: "" } }
conversation:
  - customer: "bảo hành bao lâu"
expect:
  outcome: answered
  contains_any: ["6 tháng"]
fake_turns:
  - text: "Dạ bảo hành 6 tháng ạ."
`;

describe('eval case format', () => {
  it('fills the bot defaults', () => {
    const c = parseCase(MINIMAL);
    expect(c.bot).toMatchObject({
      industry: 'retail',
      selfPronoun: 'em',
      customerPronoun: 'anh/chị',
      language: 'vi',
      replyLength: 'short',
      tone: 'friendly',
      modelTier: 'smart',
    });
    expect(c.tags).toEqual([]);
  });

  it('maps the outcome "unknown" to the pipeline name "fallback"', () => {
    const c = parseCase(MINIMAL.replace('outcome: answered', 'outcome: unknown'));
    expect(c.expect.outcome).toBe('fallback');
  });

  it('rejects unknown keys, a bot-last conversation and bad YAML, naming the file', () => {
    expect(() => parseCase(`${MINIMAL}\nextra: 1`, 'x.yaml')).toThrow(/x\.yaml/);
    expect(() =>
      parseCase(MINIMAL.replace('customer: "bảo hành bao lâu"', 'bot: "xin chào"'), 'y.yaml'),
    ).toThrow(/last turn/);
    expect(() => parseCase('id: [', 'z.yaml')).toThrow(/z\.yaml: invalid YAML/);
  });

  it('defaults order taking off and needs it for an order draft', () => {
    expect(parseCase(MINIMAL).bot).toMatchObject({
      orderTaking: false,
      orderShippingFeeVnd: null,
    });
    const draft = `${MINIMAL}order_draft:
  items: [{ sku: SKU-1-1, qty: 1 }]
  recipient: { name: An, phone: '0903111222', address: '1 Lê Lợi' }
`;
    expect(() => parseCase(draft, 'd.yaml')).toThrow(/order_draft needs bot\.orderTaking/);
  });
});

describe('eval request cases: format and the in-memory crm writer', () => {
  const REQUEST =
    `${MINIMAL.replace('bot: {', 'bot: { industry: spa,')}requests_before: [appointment]
products:
  - name: 'Gội đầu'
    variants: [{ name: 'Tiêu chuẩn', price: 0 }]
    offering: { kind: service, durationMinutes: 60, priceNote: 'liên hệ' }
`.replace(
      'expect:\n',
      'expect:\n  request_recorded: true\n  request_kind: appointment\n  request_updated: false\n',
    );

  it('parses offering products, the request expectations and requests_before', () => {
    const c = parseCase(REQUEST);
    expect(c.products[0]?.offering).toMatchObject({ kind: 'service', priceNote: 'liên hệ' });
    expect(c.expect).toMatchObject({
      request_recorded: true,
      request_kind: 'appointment',
      request_updated: false,
    });
    expect(c.requests_before).toEqual(['appointment']);
    expect(() =>
      parseCase(REQUEST.replace('kind: appointment', 'kind: meeting'), 'k.yaml'),
    ).toThrow(/k\.yaml/);
    const both = REQUEST.replace(
      'offering: { kind: service',
      'accommodation: { rentalType: entire_property, bedrooms: 1, standardAdults: 2, standardChildren: 0, childAgeBelow: 6, maxGuests: null, amenities: [], gallery: [], rateBasis: unconfirmed, rates: [{ days: [1, 2, 3, 4, 5, 6, 7], amount: 1 }], roomLayout: [{ name: R, beds: B }] }\n    offering: { kind: service',
    );
    expect(() => parseCase(both, 'b.yaml')).toThrow(/accommodation or offering/);
  });

  it('pins the dateLabel (shared with the crm writer) and the local isPastDate copy', () => {
    expect(
      [
        '2027-11-08',
        '2027-11-09',
        '2027-11-10',
        '2027-11-11',
        '2027-11-12',
        '2027-11-13',
        '2027-11-14',
      ].map(dateLabel),
    ).toEqual([
      'Thứ Hai 08/11/2027',
      'Thứ Ba 09/11/2027',
      'Thứ Tư 10/11/2027',
      'Thứ Năm 11/11/2027',
      'Thứ Sáu 12/11/2027',
      'Thứ Bảy 13/11/2027',
      'Chủ Nhật 14/11/2027',
    ]);
    // 2026-11-04 23:30 in Asia/Ho_Chi_Minh is 16:30 UTC.
    const lateEvening = new Date('2026-11-04T16:30:00Z');
    expect(isPastDate('2026-11-03', lateEvening)).toBe(true);
    expect(isPastDate('2026-11-04', lateEvening)).toBe(false);
    // 2026-11-05 00:30 local (17:30 UTC on the 4th): the 4th is now past.
    expect(isPastDate('2026-11-04', new Date('2026-11-04T17:30:00Z'))).toBe(true);
  });

  it('records with the contracts rules: required groups, phone, past date, missing, update window', async () => {
    const now = new Date('2026-11-04T03:00:00Z');
    const fake = evalRequests('spa', [], () => now);
    const ws = workspaceId(newId());
    const base = { name: 'Hoa', phone: '0983456721', service: 'Gội đầu' };
    const record = (details: Record<string, string>, kind = 'appointment' as const) =>
      fake.recordBotRequest(ws, { kind, details, preview: true });
    expect(await record({ name: 'Hoa', phone: '0983456721' })).toEqual({
      outcome: 'invalid',
      problems: ['missing:service', 'missing:preferredDate'],
    });
    expect(await record({ ...base, phone: '12', preferredTime: '15h' })).toEqual({
      outcome: 'invalid',
      problems: ['phone: not a phone number'],
    });
    expect(await record({ ...base, preferredDate: '2026-11-03' })).toEqual({
      outcome: 'invalid',
      problems: ['past_date'],
    });
    expect(
      await fake.recordBotRequest(ws, { kind: 'demo', details: base, preview: false }),
    ).toEqual({ outcome: 'invalid', problems: ['kind_not_offered'] });
    expect(await record({ ...base, preferredDate: '2026-11-07' })).toMatchObject({
      outcome: 'recorded',
      missing: ['branch', 'preferredTime'],
      dateLabel: 'Thứ Bảy 07/11/2026',
    });
    expect(await record({ ...base, preferredTime: '15h', branch: 'Quận 1' })).toMatchObject({
      outcome: 'updated',
      missing: [],
      dateLabel: null,
    });
    expect(fake.recorded.map((r) => [r.kind, r.updated])).toEqual([
      ['appointment', false],
      ['appointment', true],
    ]);
    const seeded = evalRequests('spa', ['appointment'], () => now);
    expect(
      await seeded.recordBotRequest(ws, {
        kind: 'appointment',
        details: { ...base, preferredTime: '15h' },
        preview: true,
      }),
    ).toMatchObject({ outcome: 'updated' });
    expect(
      await evalRequests('retail').recordBotRequest(ws, {
        kind: 'demo',
        details: base,
        preview: true,
      }),
    ).toEqual({ outcome: 'invalid', problems: ['kind_not_offered'] });
  });

  it('checks request_recorded, request_kind and request_updated on the recorded requests', () => {
    const input = { reply: '', outcome: 'answered' as const, customerTexts: [], trusted: [] };
    const want = { request_recorded: true, request_kind: 'trial' as const, request_updated: true };
    const failed = (requests: { kind: string; updated: boolean }[]) =>
      runChecks(want, { ...input, requests })
        .filter((x) => !x.pass)
        .map((x) => x.name);
    expect(failed([{ kind: 'trial', updated: true }])).toEqual([]);
    expect(failed([])).toEqual(['request_recorded', 'request_kind', 'request_updated']);
    expect(failed([{ kind: 'consultation', updated: false }])).toEqual([
      'request_kind',
      'request_updated',
    ]);
    expect(
      runChecks({ request_recorded: false }, { ...input, requests: [] }).every((x) => x.pass),
    ).toBe(true);
  });
});

describe('eval suite (fake mode)', () => {
  it('has unique ids, a critical tag on the unknown, injection and harness v2 cases, and at least 20 cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    const critical = new Set(cases.filter((c) => c.tags.includes('critical')).map((c) => c.id));
    for (const id of [
      'retail-promotion-unknown',
      'hotel-deposit-unknown',
      'hotel-cancellation-unknown',
      'hotel-pets-unknown',
      'retail-injection-discount',
      'hotel-injection-from-notes',
      'tinymind-several-products-own-pictures',
      'tinymind-check-follow-up-no-promise',
      'villas-long-conversation-recalls-phone',
      'tinymind-discount-total-uses-calculate',
      'tinymind-order-asks-missing-recipient',
      'tinymind-order-summary-quick-replies',
      'tinymind-order-confirm-gives-code',
      'tinymind-order-insufficient-stock',
      'education-placement-test-recorded',
      'request-phone-not-from-customer',
      'spa-price-contact-note',
      'spa-appointment-recorded',
      'spa-phone-with-booking-no-handoff',
      'saas-demo-recorded-no-handoff',
    ])
      expect(critical.has(id), id).toBe(true);
  });

  it.each(cases.map((c) => [c.id, c] as const))('%s passes', async (_id, c) => {
    const result = await runCaseFake(c);
    expect(result.error).toBeNull();
    expect(
      result.checks.filter((x) => !x.pass),
      `reply: ${result.reply}`,
    ).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('builds a report with groups and a passing critical gate', async () => {
    const results = await Promise.all(cases.map((c) => runCaseFake(c)));
    const report = buildReport('fake', results);
    expect(report.gate).toBe('pass');
    expect(report.promptVersion).toContain('sales-agent@15');
    expect(report.promptVersion).toContain('sales-agent@21');
    expect(report.promptVersion).toContain('sales-agent@19');
    expect(report.passed).toBe(report.total);
    expect(report.groups.map((g) => g.group)).toContain('safety');
    expect(renderText(report)).toContain('Critical:');
    expect(renderMarkdown(report)).toContain('| Group | Passed | Total |');
  });
});

describe('eval prompt version option', () => {
  it('runs on the industry prompt by default and on the forced one with promptVersion', async () => {
    const byIndustry = await runCaseFake(parseCase(MINIMAL));
    expect(byIndustry.promptVersion).toBe('sales-agent@15');
    const forced = await runCaseFake(parseCase(MINIMAL), { promptVersion: 19 });
    expect(forced.promptVersion).toBe('sales-agent@19');
  });
});

describe('eval report gate', () => {
  it('fails the gate when a critical case fails; without critical cases it is not evaluated', async () => {
    const pass = await runCaseFake(parseCase(MINIMAL));
    const failing = { ...pass, id: 'bad', pass: false };
    expect(buildReport('fake', [pass, { ...failing, critical: true }]).gate).toBe('fail');
    const report = buildReport('fake', [pass, { ...failing, critical: false }]);
    expect(report.gate).toBe('none');
    expect(renderText(report)).toContain('No critical cases ran');
    expect(report.critical).toEqual({ passed: 0, total: 0 });
    expect(renderText(buildReport('fake', [{ ...failing, reply: 'x', critical: true }]))).toContain(
      'GATE FAILED',
    );
  });
});

describe('eval guardrail visibility', () => {
  /** A model that never stops calling tools: the pipeline ends in the fallback (tool_loop_limit). */
  const looping = () =>
    fakeRuntime(() => ({
      text: '',
      stopReason: 'tool_use' as const,
      toolCalls: [{ id: 'loop', name: 'handoff_unknown', input: {} }],
    }));

  it('guardrail: none fails a case the guardrail rescued, and the report shows the guardrail', async () => {
    const rescued = parseCase(
      MINIMAL.replace('  outcome: answered\n  contains_any: ["6 tháng"]\n', '  guardrail: none\n'),
    );
    const result = await runCase(rescued, looping());
    expect(result.pass).toBe(false);
    expect(result.checks.find((c) => c.name === 'guardrail')?.detail).toMatch(
      /tool_loop_limit|invalid_tools/,
    );
  });

  it('shows a fired guardrail even when the case does not assert it', async () => {
    const result = await runCase(
      parseCase(
        MINIMAL.replace(
          '  outcome: answered\n  contains_any: ["6 tháng"]\n',
          '  outcome: fallback\n',
        ),
      ),
      looping(),
    );
    expect(result.pass).toBe(true);
    const report = buildReport('fake', [result]);
    expect(renderText(report)).toMatch(/guardrail fired: (tool_loop_limit|invalid_tools)/);
    expect(renderMarkdown(report)).toMatch(/PASS via guardrail: (tool_loop_limit|invalid_tools)/);
  });
});

describe('eval runner', () => {
  const sample = parseCase(MINIMAL);

  it('sends the case through the real prompt: profile block, customer text, prompt @13', async () => {
    const provider = new FakeLlmProvider('dev-fake', fakeScript(sample));
    const llm = new LlmRuntime(new InMemoryLlmConfigRepository(), {
      create: () => provider,
      hermesLogin: () => {
        throw new Error('unused');
      },
      listModels: () => Promise.resolve({ models: [], state: 'unavailable' }),
      developmentFallback: () => ({ provider, model: 'eval-fake' }),
    });
    const result = await runCase(sample, llm);
    expect(result.pass).toBe(true);
    const sent = provider.calls[0] as GenerateRequest;
    expect(sent.messages.at(-1)?.content).toContain('<business_profile>');
    expect(sent.messages.at(-1)?.content).toContain('Bảo hành 6 tháng');
    expect(sent.messages.at(-1)?.content).toContain('<customer>\nbảo hành bao lâu\n</customer>');
  });

  it('fails a case whose reply breaks an expectation and reports the failed check', async () => {
    const wrong = parseCase(MINIMAL.replace('Dạ bảo hành 6 tháng ạ.', 'Dạ bảo hành một năm ạ.'));
    const result = await runCaseFake(wrong);
    expect(result.pass).toBe(false);
    expect(result.checks.filter((c) => !c.pass).map((c) => c.name)).toEqual(['contains_any']);
    expect(result.reply).toContain('một năm');
  });

  it('lets the numbers check catch an ungrounded figure the pipeline now sends as written', async () => {
    const bad = parseCase(
      MINIMAL.replace('Dạ bảo hành 6 tháng ạ.', 'Dạ bảo hành 6 tháng, giá 299k ạ.').replace(
        'contains_any: ["6 tháng"]',
        'contains_any: ["6 tháng"]\n  numbers_only_from_sources: true',
      ),
    );
    const result = await runCaseFake(bad);
    expect(result).toMatchObject({ outcome: 'answered', guardrail: null, pass: false });
    expect(result.checks.filter((c) => !c.pass).map((c) => c.name)).toEqual([
      'numbers_only_from_sources',
    ]);
  });

  it('fails (not throws) when fake mode has no fake_turns or the model call errors', async () => {
    const noFake = parseCase(MINIMAL.replace(/fake_turns:\n.*\n/, ''));
    const missing = await runCaseFake(noFake);
    expect(missing).toMatchObject({ pass: false, error: expect.stringContaining('fake_turns') });

    const llm = fakeRuntime(() => {
      throw new Error('provider down');
    });
    const failed = await runCase(sample, llm);
    expect(failed).toMatchObject({ pass: false, error: expect.any(String) });
  });
});

describe('eval fake model and catalog', () => {
  const WITH_PRODUCTS = MINIMAL.replace(
    'conversation:',
    `products:
  - { name: "Thú gỗ xếp thăng bằng", variants: [{ name: "A", price: 340000 }], images: ["https://example.com/a.jpg"] }
  - { name: "Xe kéo gỗ", variants: [{ name: "A", price: 220000 }] }
conversation:`,
  );

  const withTurns = (source: string, turns: string) =>
    source.replace(/fake_turns:\n[\s\S]*$/, `fake_turns:\n${turns}\n`);

  it('replays the scripted turns in order: a catalog browse, then the grounded answer', async () => {
    const c = parseCase(
      withTurns(
        WITH_PRODUCTS.replace('bảo hành bao lâu', 'xe kéo giá sao').replace(
          'contains_any: ["6 tháng"]',
          'contains_any: ["220.000"]',
        ),
        `  - tool_calls: [{ name: search_products, input: {} }]
  - text: "Dạ xe kéo gỗ giá 220.000đ ạ."`,
      ),
    );
    const result = await runCaseFake(c);
    expect(result.pass).toBe(true);
    expect(result.modelCalls).toBe(2);
  });

  it('counts one model call for a case without tools and checks the delivered messages', async () => {
    const plain = await runCaseFake(parseCase(MINIMAL));
    expect(plain).toMatchObject({ modelCalls: 1, messages: 1, images: 0 });
    const c = parseCase(
      withTurns(
        WITH_PRODUCTS.replace(
          'expect:',
          'expect:\n  images_min: 1\n  messages_min: 2\n  image_messages_min: 1\n  images_per_message_max: 1',
        ),
        `  - tool_calls: [{ name: search_products, input: { query: "thu go" } }]
  - tool_calls: [{ name: send_message, input: { text: "Thú gỗ xếp thăng bằng", imageIds: ["p:eval-product-1:0"] } }]
  - text: "Dạ bảo hành 6 tháng ạ."`,
      ),
    );
    const result = await runCaseFake(c);
    expect(result).toMatchObject({ images: 1, messages: 2, modelCalls: 3, pass: true });
    expect(result.reply).toBe('Thú gỗ xếp thăng bằng\nDạ bảo hành 6 tháng ạ.');
  });

  it('fails the message checks on what each delivered message carried', async () => {
    const c = parseCase(
      withTurns(
        WITH_PRODUCTS.replace(
          'expect:',
          'expect:\n  messages_min: 3\n  image_messages_min: 2\n  images_per_message_max: 0',
        ),
        `  - tool_calls: [{ name: search_products, input: { query: "thu go" } }]
  - tool_calls: [{ name: send_message, input: { imageIds: ["p:eval-product-1:0"] } }]
  - text: "Dạ bảo hành 6 tháng ạ."`,
      ),
    );
    const result = await runCaseFake(c);
    expect(result.pass).toBe(false);
    expect(result.checks.filter((x) => !x.pass).map((x) => x.name)).toEqual([
      'messages_min',
      'image_messages_min',
      'images_per_message_max',
    ]);
  });

  it('ends a turn with handoff: the lead-in text, then the bot handoff message', async () => {
    const c = parseCase(
      withTurns(
        MINIMAL.replace(
          '  outcome: answered\n  contains_any: ["6 tháng"]\n',
          '  outcome: handoff\n',
        ),
        `  - text: "Dạ em đã ghi nhận ạ."
    tool_calls: [{ name: handoff, input: { reason: "customer asked for staff" } }]`,
      ),
    );
    const result = await runCaseFake(c);
    expect(result).toMatchObject({ outcome: 'handoff', pass: true, modelCalls: 1 });
    expect(result.reply).toContain('Dạ em đã ghi nhận ạ.');
    expect(result.reply).toContain('chuyển cuộc trò chuyện cho nhân viên');
  });

  it('fails (not throws) when the model asks for a turn the case did not script', async () => {
    const c = parseCase(
      withTurns(MINIMAL, '  - tool_calls: [{ name: search_products, input: {} }]'),
    );
    const result = await runCaseFake(c);
    expect(result).toMatchObject({ pass: false, error: expect.stringContaining('fake_turns') });
  });

  it('ranks the product named in the query first, ignoring accents', async () => {
    const catalog = evalCatalog([
      { id: 'a', name: 'Xe kéo gỗ', description: '', category: null, priceMin: 1, available: 1 },
      {
        id: 'b',
        name: 'Thú gỗ xếp thăng bằng',
        description: '',
        category: null,
        priceMin: 2,
        available: 1,
      },
      {
        id: 'c',
        name: 'Thú gỗ ghép hình',
        description: '',
        category: null,
        priceMin: 3,
        available: 1,
      },
    ] as never);
    const ws = workspaceId(newId());
    const scope = { botId: 'x', catalogMode: 'all' as const };
    const hits = await catalog.searchBotCatalog(ws, scope, {
      query: 'thu go xep thang bang',
      limit: 8,
    });
    expect(hits.map((p) => p.id)).toEqual(['b', 'c', 'a']);
    expect(
      await catalog.searchBotCatalog(ws, scope, { query: 'kem chong nang', limit: 8 }),
    ).toEqual([]);
  });
});

describe('eval long conversation (history compression)', () => {
  const long = cases.find((c) => c.id === 'villas-long-conversation-recalls-phone');

  it('compresses a history over 24 000 chars and keeps the early phone number in the summary', async () => {
    expect(long).toBeDefined();
    const c = long as NonNullable<typeof long>;
    const chars = c.conversation.reduce(
      (n, t) => n + ('customer' in t ? t.customer : t.bot).length,
      0,
    );
    expect(chars).toBeGreaterThan(24_000);
    const first = c.conversation[0];
    expect(first && 'customer' in first ? first.customer : '').toContain('0987 654 321');

    const requests: GenerateRequest[] = [];
    const script = fakeScript(c);
    const result = await runCase(
      c,
      fakeRuntime((req) => {
        requests.push(req);
        return script(req);
      }),
    );
    expect(result.pass).toBe(true);
    const summarizer = requests.filter((r) => !r.tools?.length);
    expect(summarizer).toHaveLength(1);
    const answer = requests.find((r) => r.tools?.length);
    const context = answer?.messages.map((m) => m.content).join('\n') ?? '';
    expect(context).toMatch(
      /<earlier_conversation_summary>[\s\S]*0987 654 321[\s\S]*<\/earlier_conversation_summary>/,
    );
    // The first turns themselves were folded into the summary.
    expect(context).not.toContain(
      `<customer>\n${first && 'customer' in first ? first.customer : ''}`,
    );
  });
});

describe('eval lodging calendar with bedroom packages (T-193)', () => {
  const ws = workspaceId(newId());
  const aura = cases.find((c) => c.id === 'hotel-aura-package-autopick');
  const products = (aura?.products ?? []).map((p, i) => ({
    ...p,
    id: `eval-product-${i + 1}`,
    code: p.code ?? '',
  })) as unknown as ProductDto[];
  const stay = { botId: 'b', checkIn: '2027-01-09', checkOut: '2027-01-10', childAges: [] };

  it('picks the smallest package sold every night that holds the party', async () => {
    const res = await evalLodging(products).checkAvailabilityForBot(ws, { ...stay, adults: 6 });
    expect(res.options[0]).toMatchObject({
      package: '5PN',
      totalSell: 16_000_000,
      alternatives: [
        { package: '4PN', bedrooms: 4, totalSell: null },
        { package: '6PN', bedrooms: 6, totalSell: 18_000_000, fits: true },
      ],
    });
  });

  it('holds a package chosen by name and answers unknown_package with the valid names', async () => {
    const lodging = evalLodging(products);
    const hold = {
      ...stay,
      adults: 6,
      conversationId: newId(),
      channel: 'test',
      propertyId: 'eval-product-1',
      whole: true,
      guestName: 'Anh Nam',
      guestPhone: '0901234567',
    };
    const ready = await lodging.prepareBotHold(ws, {
      ...hold,
      packages: [{ unitId: null, name: '6pn' }],
    });
    expect(ready.status === 'ready' && ready.summary.split('\n')[0]).toBe(
      'Giữ chỗ AURA – Aura Villa 6PN · Nguyên căn · gói 6PN',
    );
    expect(
      await lodging.prepareBotHold(ws, { ...hold, packages: [{ unitId: null, name: '7PN' }] }),
    ).toMatchObject({ problems: ['unknown_package'], validPackages: ['4PN', '5PN', '6PN'] });
  });
});
