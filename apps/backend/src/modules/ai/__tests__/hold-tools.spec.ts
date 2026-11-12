import {
  FakeLlmProvider,
  type GenerateRequest,
  type GenerateResponse,
  type ToolCall,
} from '@agent-sales/ai-core';
import type { ProductDto } from '@agent-sales/contracts';
import { DomainError, newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { KnowledgeFacade } from '../../knowledge/api/index.js';
import type {
  BotAvailabilityOption,
  BotAvailabilityResult,
  ConfirmBotHoldResult,
  LodgingBotFacade,
  LodgingCatalogFacade,
  PrepareBotHoldResult,
} from '../../lodging/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import type { OutgoingMessage } from '../api/reply-options.js';
import {
  CANCEL_HOLD_DRAFT_TOOL,
  CHECK_AVAILABILITY_TOOL,
  CONFIRM_HOLD_TOOL,
  HOLD_QUICK_REPLIES,
  type HoldToolContext,
  holdCreatedText,
  holdTools,
  localHoldTime,
  newHoldToolState,
  PREPARE_HOLD_TOOL,
} from '../application/hold-tools.js';
import { adultsVouched, unvouchedChildAges } from '../domain/child-ages.js';
import type { LlmRuntime } from '../application/llm-runtime.js';
import { newOutputState } from '../application/output-tools.js';
import { PlaygroundService } from '../application/playground.service.js';
import { InMemoryAiRunRepository } from '../infrastructure/persistence/ai-run.repositories.js';

const ws = workspaceId(newId());
const botId = newId();
const conversationId = newId();
const A17 = newId();
const B02 = newId();
const ROOM_1 = newId();
const ROOM_2 = newId();

const SUMMARY =
  'Giữ chỗ SKY VILLA A17\n06/11 (T6) → 08/11 (CN) · 2 đêm\n20 người lớn\nTổng: 27.000.000đ\nTên: Anh Nam · SĐT: 0901 234 567\nGiữ trong 2 giờ, nhân viên sẽ gọi xác nhận.';

const option = (over: Partial<BotAvailabilityOption> = {}): BotAvailabilityOption => ({
  propertyId: A17,
  code: 'A17',
  name: 'SKY VILLA A17',
  whole: true,
  unitIds: [],
  unitNames: [],
  fits: true,
  overStandard: false,
  minNights: null,
  problems: [],
  totalSell: 27_000_000,
  package: null,
  alternatives: [],
  nightly: [
    { date: '2026-11-06', weekdayLabel: 'Thứ Sáu', label: 'Thứ Sáu', sell: 13_000_000 },
    { date: '2026-11-07', weekdayLabel: 'Thứ Bảy', label: 'Thứ Bảy', sell: 14_000_000 },
  ],
  surcharges: [],
  ...over,
});

const availability = (over: Partial<BotAvailabilityResult> = {}): BotAvailabilityResult => ({
  nights: 2,
  checkInWeekdayLabel: 'Thứ Sáu',
  checkOutWeekdayLabel: 'Chủ Nhật',
  requestedFull: false,
  options: [option()],
  problems: [],
  ...over,
});

/** A fake lodging bot facade with one draft slot, like the `lodging_bot_hold_drafts` row. */
function fakeLodging(
  opts: {
    check?: BotAvailabilityResult | Error;
    prepare?: PrepareBotHoldResult | Error;
    confirm?: ConfirmBotHoldResult;
    storedAt?: Date | null;
  } = {},
) {
  const facade = {
    draft: opts.storedAt ? { storedAt: opts.storedAt } : null,
    checkAvailabilityForBot: vi.fn(async () => {
      if (opts.check instanceof Error) throw opts.check;
      return opts.check ?? availability();
    }),
    prepareBotHold: vi.fn(async () => {
      if (opts.prepare instanceof Error) throw opts.prepare;
      const res = opts.prepare ?? { status: 'ready' as const, summary: SUMMARY, holdMinutes: 120 };
      if (res.status === 'ready') facade.draft = { storedAt: new Date() };
      return res;
    }),
    confirmBotHold: vi.fn(async (): Promise<ConfirmBotHoldResult> => {
      if (opts.confirm) return opts.confirm;
      if (!facade.draft) return { status: 'no_draft', alternatives: [] };
      facade.draft = null;
      return { status: 'held', code: 'BK0042', holdExpiresAt: '2026-11-01T09:30:00.000Z' };
    }),
    cancelBotHoldDraft: vi.fn(async () => {
      facade.draft = null;
    }),
    hasBotHoldDraft: vi.fn(async () => ({
      pending: facade.draft !== null,
      storedAt: facade.draft?.storedAt ?? null,
    })),
  };
  return facade as unknown as LodgingBotFacade & {
    draft: { storedAt: Date } | null;
  } & Record<keyof LodgingBotFacade, ReturnType<typeof vi.fn>>;
}

const property = (id: string, code: string, name: string): ProductDto =>
  ({ id, code, name: `${code} – ${name}` }) as ProductDto;

function fakeCatalog(
  rows: ProductDto[] = [property(A17, 'A17', 'Sky Villa'), property(B02, 'B02', 'Garden')],
) {
  return {
    searchBotCatalog: vi.fn(async (_ws, _bot, input: { query?: string }) =>
      input.query
        ? rows.filter((r) => r.name.toLowerCase().includes((input.query ?? '').toLowerCase()))
        : rows,
    ),
    getBotProductsByIds: vi.fn(async () => []),
    countBotCatalog: vi.fn(async () => rows.length),
  } as unknown as LodgingCatalogFacade;
}

const recordingSink = (delivered = 1, complete?: boolean) => {
  const sent: OutgoingMessage[] = [];
  return {
    sent,
    send: async (m: OutgoingMessage) => (
      sent.push(m),
      { delivered, ...(complete === undefined ? {} : { complete }) }
    ),
  };
};

function context(facade: LodgingBotFacade, extra: Partial<HoldToolContext> = {}): HoldToolContext {
  return {
    facade,
    catalog: fakeCatalog(),
    ws,
    botId,
    conversationId,
    channel: 'facebook',
    output: newOutputState(),
    takesHolds: true,
    confirmable: false,
    contactId: null,
    state: newHoldToolState(),
    ...extra,
  };
}

const tool = (ctx: HoldToolContext, name: string) => {
  const found = holdTools(ctx).runnable.find((t) => t.name === name);
  if (!found) throw new Error(`no ${name}`);
  return found;
};

const STAY = { checkIn: '2026-11-06', checkOut: '2026-11-08', adults: 20 };
const HOLD = { ...STAY, propertyCode: 'A17', guestName: 'Anh Nam', guestPhone: '0901234567' };

describe('hold tools: gating (spec §4)', () => {
  it('offers check_availability alone without the order-taking switch', () => {
    const ctx = context(fakeLodging(), { takesHolds: false, confirmable: true });
    expect(holdTools(ctx).definitions.map((d) => d.name)).toEqual([CHECK_AVAILABILITY_TOOL]);
    expect(holdTools(ctx).runnable.find((t) => t.name === CHECK_AVAILABILITY_TOOL)?.readOnly).toBe(
      true,
    );
  });

  it('adds prepare_hold, and confirm / cancel only while a draft from before the customer answer waits', () => {
    const ctx = context(fakeLodging());
    expect(holdTools(ctx).definitions.map((d) => d.name)).toEqual([
      CHECK_AVAILABILITY_TOOL,
      PREPARE_HOLD_TOOL,
    ]);
    expect(holdTools({ ...ctx, confirmable: true }).definitions.map((d) => d.name)).toEqual([
      CHECK_AVAILABILITY_TOOL,
      PREPARE_HOLD_TOOL,
      CONFIRM_HOLD_TOOL,
      CANCEL_HOLD_DRAFT_TOOL,
    ]);
    // EV-8: a hold lost before the confirm is apologised for, then the alternatives offered.
    const confirm = holdTools({ ...ctx, confirmable: true }).definitions.find(
      (d) => d.name === CONFIRM_HOLD_TOOL,
    );
    expect(confirm?.description).toContain('apologise that it was just taken');
  });
});

describe('check_availability', () => {
  it('accepts a party of children only (at least one guest), as the lodging module does', () => {
    const schema = tool(context(fakeLodging()), CHECK_AVAILABILITY_TOOL).schema;
    expect(schema.safeParse({ ...STAY, adults: 0, childAges: [8] }).success).toBe(true);
    expect(schema.safeParse({ ...STAY, adults: 0 }).success).toBe(false);
    expect(schema.safeParse({ ...STAY, adults: 0, childAges: [] }).success).toBe(false);
    expect(
      tool(context(fakeLodging()), PREPARE_HOLD_TOOL).schema.safeParse({
        ...HOLD,
        adults: 0,
        childAges: [8],
      }).success,
    ).toBe(true);
  });

  it('maps the property code to its id and shows the model no ids', async () => {
    const facade = fakeLodging({
      check: availability({
        requestedFull: true,
        options: [
          option({
            propertyId: B02,
            code: 'B02',
            name: 'Garden',
            whole: false,
            unitIds: [ROOM_1],
            unitNames: ['Phòng 1'],
          }),
        ],
      }),
    });
    const out = await tool(context(facade), CHECK_AVAILABILITY_TOOL).run({
      ...STAY,
      childAges: [4],
      propertyCode: 'a17',
    });
    expect(facade.checkAvailabilityForBot).toHaveBeenCalledWith(ws, {
      botId,
      checkIn: '2026-11-06',
      checkOut: '2026-11-08',
      adults: 20,
      childAges: [4],
      propertyId: A17,
    });
    const body = JSON.parse(out.content);
    expect(out.ok).toBe(true);
    expect(body).toMatchObject({
      ok: true,
      nights: 2,
      checkInWeekdayLabel: 'Thứ Sáu',
      requestedFull: true,
      options: [{ code: 'B02', whole: false, rooms: ['Phòng 1'], totalSell: 27_000_000 }],
    });
    expect(out.content).not.toContain(B02);
    expect(out.content).not.toContain(ROOM_1);
    expect(out.content).not.toContain('propertyId');
    expect(out.productIds).toEqual([B02]);
  });

  it('answers an unknown property code without reading the calendar', async () => {
    const facade = fakeLodging();
    const out = await tool(context(facade), CHECK_AVAILABILITY_TOOL).run({
      ...STAY,
      propertyCode: 'ZZ9',
    });
    expect(JSON.parse(out.content)).toEqual({ ok: false, error: 'unknown_property_code' });
    expect(out.ok).toBe(false);
    expect(facade.checkAvailabilityForBot).not.toHaveBeenCalled();
  });

  it('passes the server problems through (past dates) as a failed result', async () => {
    const facade = fakeLodging({ check: availability({ options: [], problems: ['past_date'] }) });
    const out = await tool(context(facade), CHECK_AVAILABILITY_TOOL).run(STAY);
    expect(JSON.parse(out.content)).toMatchObject({ ok: false, problems: ['past_date'] });
  });

  it('turns a validation failure of the lodging module into a problem, not a tool error', async () => {
    class Invalid extends DomainError {
      readonly code = 'VALIDATION_FAILED';
    }
    const facade = fakeLodging({ check: new Invalid('check-out must follow check-in') });
    const out = await tool(context(facade), CHECK_AVAILABILITY_TOOL).run(STAY);
    expect(JSON.parse(out.content)).toEqual({ ok: false, problems: ['invalid_request'] });
  });
});

describe('prepare_hold', () => {
  it('sends exactly one server summary with the hold buttons, then awaits the customer', async () => {
    const facade = fakeLodging();
    const sink = recordingSink();
    const ctx = context(facade, { sink });
    const out = await tool(ctx, PREPARE_HOLD_TOOL).run({ ...HOLD, note: ' ' });
    expect(facade.prepareBotHold).toHaveBeenCalledWith(ws, {
      botId,
      conversationId,
      channel: 'facebook',
      propertyId: A17,
      whole: true,
      unitIds: [],
      checkIn: '2026-11-06',
      checkOut: '2026-11-08',
      adults: 20,
      childAges: [],
      guestName: 'Anh Nam',
      guestPhone: '0901234567',
      contactId: null,
    });
    expect(sink.sent).toEqual([
      {
        text: SUMMARY,
        images: [],
        quickReplies: [
          { title: '✅ Giữ chỗ', payload: 'HOLD_CONFIRM' },
          { title: '✏️ Sửa thông tin', payload: 'HOLD_EDIT' },
        ],
      },
    ]);
    expect(HOLD_QUICK_REPLIES.map((q) => q.payload)).toEqual(['HOLD_CONFIRM', 'HOLD_EDIT']);
    expect(JSON.parse(out.content)).toEqual({
      ok: true,
      status: 'awaiting_customer_confirmation',
      holdMinutes: 120,
    });
    expect(ctx.output.sent).toHaveLength(1);
    expect(ctx.state.stored).toBe(true);

    const again = await tool(ctx, PREPARE_HOLD_TOOL).run(HOLD);
    expect(JSON.parse(again.content)).toEqual({ ok: false, error: 'already_sent' });
    expect(sink.sent).toHaveLength(1);
  });

  it('maps room names back to the room ids of the property', async () => {
    const facade = fakeLodging({
      check: availability({
        options: [
          option({ whole: true, unitIds: [ROOM_1, ROOM_2], unitNames: ['Phòng 1', 'Phòng 2'] }),
        ],
      }),
    });
    await tool(context(facade), PREPARE_HOLD_TOOL).run({ ...HOLD, rooms: ['phòng 2'] });
    expect(facade.prepareBotHold).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({ propertyId: A17, whole: false, unitIds: [ROOM_2] }),
    );
  });

  it('refuses a room name the property does not have', async () => {
    const facade = fakeLodging({
      check: availability({
        options: [option({ whole: true, unitIds: [ROOM_1], unitNames: ['Phòng 1'] })],
      }),
    });
    const out = await tool(context(facade), PREPARE_HOLD_TOOL).run({ ...HOLD, rooms: ['Phòng 9'] });
    expect(JSON.parse(out.content)).toEqual({
      ok: false,
      error: 'unknown_room',
      rooms: ['Phòng 1'],
    });
    expect(facade.prepareBotHold).not.toHaveBeenCalled();
  });

  it('passes the chosen packages by name, the whole property when no room is given (T-193)', async () => {
    const facade = fakeLodging({
      check: availability({
        options: [
          option({ whole: true, unitIds: [ROOM_1, ROOM_2], unitNames: ['Bungalow 1', 'Phòng 2'] }),
        ],
      }),
    });
    await tool(context(facade), PREPARE_HOLD_TOOL).run({
      ...HOLD,
      packages: [{ package: ' 5PN ' }, { room: 'bungalow 1', package: '2PN' }],
    });
    expect(facade.prepareBotHold).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        whole: true,
        packages: [
          { unitId: null, name: '5PN' },
          { unitId: ROOM_1, name: '2PN' },
        ],
      }),
    );
  });

  it('refuses a package room the property does not have (T-193)', async () => {
    const facade = fakeLodging({
      check: availability({
        options: [option({ whole: true, unitIds: [ROOM_1], unitNames: ['Bungalow 1'] })],
      }),
    });
    const out = await tool(context(facade), PREPARE_HOLD_TOOL).run({
      ...HOLD,
      packages: [{ room: 'Bungalow 9', package: '2PN' }],
    });
    expect(JSON.parse(out.content)).toEqual({
      ok: false,
      error: 'unknown_room',
      rooms: ['Bungalow 1'],
    });
    expect(facade.prepareBotHold).not.toHaveBeenCalled();
  });

  it('answers an unknown package with the valid names (T-193)', async () => {
    const facade = fakeLodging({
      prepare: {
        status: 'problems',
        problems: ['unknown_package'],
        alternatives: [],
        validPackages: ['4PN', '5PN', '6PN'],
      },
    });
    const out = await tool(context(facade), PREPARE_HOLD_TOOL).run({
      ...HOLD,
      packages: [{ package: '7PN' }],
    });
    expect(JSON.parse(out.content)).toEqual({
      ok: false,
      problems: ['unknown_package'],
      alternatives: [],
      valid: ['4PN', '5PN', '6PN'],
    });
  });

  it('shows the option package and its alternatives to the model (T-193)', async () => {
    const alternatives = [{ package: '6PN', bedrooms: 6, totalSell: 30_000_000, fits: true }];
    const facade = fakeLodging({
      check: availability({ options: [option({ package: '5PN', alternatives })] }),
    });
    const out = await tool(context(facade), CHECK_AVAILABILITY_TOOL).run(STAY);
    // VL-B12: the nights are the picked package's; an alternative has its total and no nights.
    expect(JSON.parse(out.content).options[0]).toMatchObject({
      package: '5PN',
      nightlyPackage: '5PN',
      alternatives: alternatives.map((a) => ({ ...a, nightly: null })),
    });
  });

  it('returns problems and id-free alternatives, sending nothing', async () => {
    const facade = fakeLodging({
      prepare: {
        status: 'problems',
        problems: ['not_available'],
        alternatives: [option({ propertyId: B02, code: 'B02' })],
      },
    });
    const sink = recordingSink();
    const out = await tool(context(facade, { sink }), PREPARE_HOLD_TOOL).run(HOLD);
    const body = JSON.parse(out.content);
    expect(body).toMatchObject({
      ok: false,
      problems: ['not_available'],
      alternatives: [{ code: 'B02' }],
    });
    expect(out.content).not.toContain(B02);
    expect(sink.sent).toEqual([]);
  });

  it('drops the draft when the summary did not fully reach the customer', async () => {
    const facade = fakeLodging();
    const ctx = context(facade, { sink: recordingSink(1, false) });
    const out = await tool(ctx, PREPARE_HOLD_TOOL).run(HOLD);
    expect(JSON.parse(out.content)).toEqual({ ok: false, error: 'not_delivered' });
    expect(facade.cancelBotHoldDraft).toHaveBeenCalledWith(ws, { conversationId });
    expect(ctx.output.sent).toEqual([]);
  });
});

describe('prepare_hold: contact and property lookup', () => {
  it('passes the conversation contact to the hold draft', async () => {
    const contactId = newId();
    const facade = fakeLodging();
    await tool(context(facade, { contactId }), PREPARE_HOLD_TOOL).run(HOLD);
    expect(facade.prepareBotHold).toHaveBeenCalledWith(ws, expect.objectContaining({ contactId }));
  });

  it('finds a code the search misses by paging through every property the bot sells', async () => {
    const rows = [property(B02, 'B02', 'Garden'), property(A17, 'A17', 'Sky Villa')];
    const catalog = {
      searchBotCatalog: vi.fn(async () => []),
      getBotProductsByIds: vi.fn(async (_ws, _bot, ids: readonly string[]) =>
        rows.filter((r) => ids.includes(r.id)),
      ),
      countBotCatalog: vi.fn(async () => rows.length),
    } as unknown as LodgingCatalogFacade;
    const many = [...Array.from({ length: 23 }, () => newId()), B02, A17];
    const facade = fakeLodging();
    await tool(
      context(facade, { catalog, propertyIds: async () => many }),
      CHECK_AVAILABILITY_TOOL,
    ).run({ ...STAY, propertyCode: 'A17' });
    expect(facade.checkAvailabilityForBot).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({ propertyId: A17 }),
    );
    // Pages of 10 ids (the catalog's maximum), until the code is found.
    expect(catalog.getBotProductsByIds).toHaveBeenCalledTimes(3);
  });
});

describe('confirm_hold / cancel_hold_draft', () => {
  it('creates the hold from the stored draft only and records its code and expiry', async () => {
    const facade = fakeLodging({ storedAt: new Date(0) });
    const ctx = context(facade, { confirmable: true });
    const out = await tool(ctx, CONFIRM_HOLD_TOOL).run({ propertyCode: 'B02' });
    expect(facade.confirmBotHold).toHaveBeenCalledWith(ws, { conversationId });
    expect(JSON.parse(out.content)).toEqual({ ok: true, code: 'BK0042', heldUntil: '16:30 01/11' });
    expect(ctx.state.created).toEqual({ code: 'BK0042', expiresAt: '2026-11-01T09:30:00.000Z' });
  });

  it('cannot confirm a draft stored in the same turn', async () => {
    const facade = fakeLodging({ storedAt: new Date(0) });
    const ctx = context(facade, { confirmable: true });
    await tool(ctx, PREPARE_HOLD_TOOL).run(HOLD);
    const out = await tool(ctx, CONFIRM_HOLD_TOOL).run({});
    expect(JSON.parse(out.content)).toEqual({ ok: false, code: 'not_confirmable' });
    expect(facade.confirmBotHold).not.toHaveBeenCalled();
  });

  it('reports a lost hold with id-free alternatives', async () => {
    const facade = fakeLodging({
      storedAt: new Date(0),
      confirm: {
        status: 'not_available',
        alternatives: [option({ propertyId: B02, code: 'B02' })],
      },
    });
    const ctx = context(facade, { confirmable: true });
    const out = await tool(ctx, CONFIRM_HOLD_TOOL).run({});
    expect(JSON.parse(out.content)).toMatchObject({
      ok: false,
      status: 'not_available',
      alternatives: [{ code: 'B02' }],
    });
    expect(out.content).not.toContain(B02);
    expect(ctx.state.created).toBeNull();
  });

  it('cancels the waiting draft', async () => {
    const facade = fakeLodging({ storedAt: new Date(0) });
    const out = await tool(context(facade, { confirmable: true }), CANCEL_HOLD_DRAFT_TOOL).run({});
    expect(JSON.parse(out.content)).toEqual({ ok: true, status: 'cancelled' });
    expect(facade.cancelBotHoldDraft).toHaveBeenCalledWith(ws, { conversationId });
  });

  it('never throws on a held result without a readable expiry', async () => {
    expect(localHoldTime('')).toBeNull();
    expect(localHoldTime('not a date')).toBeNull();
    expect(holdCreatedText('BK0042', '')).toBe(
      'Dạ em đã giữ chỗ BK0042 ạ. Nhân viên sẽ gọi xác nhận sớm ạ.',
    );
    const facade = fakeLodging({
      storedAt: new Date(0),
      confirm: { status: 'held', code: 'BK0042', holdExpiresAt: '' },
    });
    const ctx = context(facade, { confirmable: true });
    const out = await tool(ctx, CONFIRM_HOLD_TOOL).run({});
    expect(JSON.parse(out.content)).toEqual({ ok: true, code: 'BK0042' });
    expect(ctx.state.created).toEqual({ code: 'BK0042', expiresAt: '' });
  });

  it('words the held line with the local expiry time and date', () => {
    expect(holdCreatedText('BK0042', '2026-11-01T17:05:00.000Z')).toBe(
      'Dạ em đã giữ chỗ BK0042 đến 00:05 ngày 02/11 ạ. Nhân viên sẽ gọi xác nhận sớm ạ.',
    );
  });
});

// ── Pipeline wiring ─────────────────────────────────────────────────────────────────────────────

const hotel: BotView = {
  id: botId,
  name: 'Villa Bot',
  industry: 'hotel',
  isActive: true,
  catalogMode: 'all',
  mission: '',
  greeting: 'Dạ',
  selfPronoun: 'em',
  customerPronoun: 'anh/chị',
  fallbackMessage: 'Dạ em chưa rõ ạ.',
  handoffMessage: 'Dạ em chuyển nhân viên ạ.',
  creativity: 'balanced',
  modelTier: 'smart',
  language: 'vi',
  profile: { fields: {}, notes: '' },
  replyLength: 'short',
  tone: 'friendly',
  allowEmoji: false,
  placeholders: {},
  orderTaking: true,
};

type Script = (req: GenerateRequest, round: number) => Partial<GenerateResponse>;

function pipeline(script: Script, opts: { bot?: BotView; lodging?: LodgingBotFacade } = {}) {
  const fake = new FakeLlmProvider('dev-fake', (req: GenerateRequest) => {
    const round = req.messages.filter((m) => m.role === 'assistant' && m.toolCalls?.length).length;
    return { text: '', ...script(req, round) };
  });
  const runs = new InMemoryAiRunRepository();
  const commerce = {
    hasBotOrderDraft: vi.fn(async () => ({ pending: false, storedAt: null })),
    prepareBotOrder: vi.fn(),
  };
  const svc = new PlaygroundService(
    { getBot: async () => opts.bot ?? hotel } as BotFacade,
    { searchFaqs: async () => [] } as unknown as KnowledgeFacade,
    { getById: async () => ({ name: 'Villas' }) } as unknown as WorkspaceFacade,
    {
      generate: (req: GenerateRequest) => fake.generate(req, { model: 'echo' }),
    } as unknown as LlmRuntime,
    runs,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    commerce as never,
    fakeCatalog(),
    opts.lodging ?? fakeLodging(),
  );
  return { svc, fake, commerce };
}

const toolNames = (req: GenerateRequest | undefined) => (req?.tools ?? []).map((t) => t.name);
const call = (name: string, input: Record<string, unknown> = {}): Partial<GenerateResponse> => ({
  stopReason: 'tool_use',
  toolCalls: [{ id: `c-${name}`, name, input } as ToolCall],
});
const ask = (text: string) => ({ messages: [{ role: 'customer' as const, content: text }] });

describe('hotel bot pipeline (spec §4)', () => {
  it('gives a hotel bot with order taking the hold tools and no retail order tools', async () => {
    const { svc, fake } = pipeline(() => ({ text: 'Dạ' }));
    await svc.playground(ws, botId, ask('A17 còn trống không'));
    const names = toolNames(fake.calls[0] as GenerateRequest);
    expect(names).toEqual(expect.arrayContaining([CHECK_AVAILABILITY_TOOL, PREPARE_HOLD_TOOL]));
    expect(names).not.toContain(CONFIRM_HOLD_TOOL);
    expect(names.some((n) => n.includes('order'))).toBe(false);
  });

  it('gives a hotel bot without order taking only check_availability', async () => {
    const { svc, fake } = pipeline(() => ({ text: 'Dạ' }), {
      bot: { ...hotel, orderTaking: false },
    });
    await svc.playground(ws, botId, ask('A17 còn trống không'));
    const names = toolNames(fake.calls[0] as GenerateRequest);
    expect(names).toContain(CHECK_AVAILABILITY_TOOL);
    expect(names.some((n) => n.includes('hold'))).toBe(false);
  });

  it('gives a retail bot no lodging tools', async () => {
    const { svc, fake } = pipeline(() => ({ text: 'Dạ' }), {
      bot: { ...hotel, industry: 'retail' },
    });
    await svc.playground(ws, botId, ask('còn áo không'));
    const names = toolNames(fake.calls[0] as GenerateRequest);
    expect(names).not.toContain(CHECK_AVAILABILITY_TOOL);
    expect(names).toContain('prepare_order');
  });

  it('offers confirm_hold once the customer answered a draft from an earlier turn', async () => {
    const { svc, fake } = pipeline(() => ({ text: 'Dạ' }), {
      lodging: fakeLodging({ storedAt: new Date(Date.now() - 60_000) }),
    });
    await svc.playground(ws, botId, ask('✅ Giữ chỗ'));
    expect(toolNames(fake.calls[0] as GenerateRequest)).toEqual(
      expect.arrayContaining([CONFIRM_HOLD_TOOL, CANCEL_HOLD_DRAFT_TOOL]),
    );
  });

  it('passes the reply contact to prepare_hold (none in the playground)', async () => {
    const lodging = fakeLodging();
    const { svc } = pipeline(
      (_req, round) => (round === 0 ? call(PREPARE_HOLD_TOOL, HOLD) : { text: '' }),
      { lodging },
    );
    await svc.playground(ws, botId, ask('Giữ A17'));
    expect(lodging.prepareBotHold).toHaveBeenLastCalledWith(
      ws,
      expect.objectContaining({ contactId: null }),
    );
    const contactId = newId();
    await svc.reply(ws, botId, ask('Giữ A17'), {
      conversationId: newId(),
      isTest: false,
      channel: 'facebook',
      contactId,
    });
    expect(lodging.prepareBotHold).toHaveBeenLastCalledWith(
      ws,
      expect.objectContaining({ contactId, channel: 'facebook' }),
    );
  });

  it('keeps the hold summary the last message: a final after it is dropped', async () => {
    const { svc } = pipeline((_req, round) =>
      round === 0 ? call(PREPARE_HOLD_TOOL, HOLD) : { text: 'Dạ anh xem tóm tắt giúp em ạ' },
    );
    const res = await svc.playground(ws, botId, ask('Giữ A17 cho anh, Anh Nam 0901234567'));
    expect(res.messages?.map((m) => m.text)).toEqual([SUMMARY]);
    expect(res.messages?.at(-1)?.quickReplies?.[0]?.payload).toBe('HOLD_CONFIRM');
  });

  it('announces the held code and expiry exactly once', async () => {
    const lodging = fakeLodging({ storedAt: new Date(Date.now() - 60_000) });
    const { svc } = pipeline(
      (_req, round) => (round === 0 ? call(CONFIRM_HOLD_TOOL) : { text: '' }),
      {
        lodging,
      },
    );
    const res = await svc.playground(ws, botId, ask('ok giữ đi em'));
    expect(res.reply).toBe(holdCreatedText('BK0042', '2026-11-01T09:30:00.000Z'));
    expect((res as { orderCreated?: boolean }).orderCreated).toBe(true);

    // The code without the expiry time is not enough: the held line is still added.
    const echoed = pipeline(
      (_req, round) =>
        round === 0 ? call(CONFIRM_HOLD_TOOL) : { text: 'Dạ em đã giữ chỗ BK0042 ạ.' },
      { lodging: fakeLodging({ storedAt: new Date(Date.now() - 60_000) }) },
    );
    const again = await echoed.svc.playground(ws, botId, ask('ok'));
    expect(again.reply).toBe(
      `Dạ em đã giữ chỗ BK0042 ạ.\n${holdCreatedText('BK0042', '2026-11-01T09:30:00.000Z')}`,
    );

    // Code and expiry time already stated: nothing is added.
    const full = pipeline(
      (_req, round) =>
        round === 0
          ? call(CONFIRM_HOLD_TOOL)
          : { text: 'Dạ em đã giữ chỗ BK0042 đến 16:30 hôm nay ạ.' },
      { lodging: fakeLodging({ storedAt: new Date(Date.now() - 60_000) }) },
    );
    const once = await full.svc.playground(ws, botId, ask('ok'));
    expect(once.reply).toBe('Dạ em đã giữ chỗ BK0042 đến 16:30 hôm nay ạ.');
  });
});

describe('check_availability child ages (VL-B3)', () => {
  it('accepts only ages the customer wrote next to an age word', () => {
    const said = (text: string, ages: number[]) => unvouchedChildAges(ages, [text]);
    // "8" of the date is not an age; the kids' ages were never given.
    expect(said('20 người lớn với 4 bé, A17 từ 8/1/2027 đến 10/1/2027', [8, 8, 8, 8])).toEqual([
      8, 8, 8, 8,
    ]);
    expect(said('9 người lớn và 3 bé 4, 4, 9 tuổi', [4, 4, 9])).toEqual([]);
    expect(said('2 bé 5 và 7 tuổi', [5, 7])).toEqual([]);
    expect(said('kids aged 6 years', [6])).toEqual([]);
    expect(said('bé 18 tháng với bé sơ sinh', [1, 0])).toEqual([]);
    expect(said('bé 4t', [4])).toEqual([]);
    expect(said('bé 4 tuổi', [5])).toEqual([5]);
  });

  it('accepts only an adult count the customer wrote next to a party word', () => {
    expect(adultsVouched(20, ['nhà chị 20 người lớn với 4 bé'])).toBe(true);
    expect(adultsVouched(10, ['Hi, we are 10 adults'])).toBe(true);
    expect(adultsVouched(2, ['A17 còn trống cuối tuần này không? ở 2 đêm'])).toBe(false);
    expect(adultsVouched(0, ['A17 còn trống không'])).toBe(true);
  });

  it('refuses a check with an age the customer never wrote, without calling the calendar', async () => {
    const facade = fakeLodging();
    const ctx = { ...context(facade), customerTexts: ['20 người lớn với 2 bé, 8/1/2027'] };
    const out = await tool(ctx, CHECK_AVAILABILITY_TOOL).run({ ...STAY, childAges: [8, 8] });
    expect(JSON.parse(out.content)).toEqual({ ok: false, problems: ['child_ages_not_given'] });
    expect(facade.checkAvailabilityForBot).not.toHaveBeenCalled();
  });
});
