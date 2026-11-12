import type { RunnableTool, ToolDefinition } from '@agent-sales/ai-core';
import { DomainError, type WorkspaceId } from '@agent-sales/shared';
import { z } from 'zod';

import type {
  BotAvailabilityOption,
  LodgingBotFacade,
  LodgingCatalogFacade,
  LodgingFacade,
} from '../../lodging/api/index.js';
import type { MessageSink, OutgoingMessage, QuickReply } from '../api/reply-options.js';
import { safeJson } from './action-tools.js';
import { resolveRooms } from './hold-rooms.js';
import { confirmableDraft } from './order-tools.js';
import type { OutputState } from './output-tools.js';
import { SHOP_TIME_ZONE } from './reply-context.js';

/**
 * Lodging availability and holds for hotel bots (T-161, spec 2026-11-01-bot-lodging-holds §4), the
 * same flow as bot orders (ADR-016): the server checks the calendar and quotes, the bot prepares a
 * hold, the server sends the summary, the customer confirms, staff call to confirm the booking.
 * Every rule lives in the lodging module; these tools only map codes and names to ids and keep ids
 * away from the model.
 */

export const CHECK_AVAILABILITY_TOOL = 'check_availability';
export const PREPARE_HOLD_TOOL = 'prepare_hold';
export const CONFIRM_HOLD_TOOL = 'confirm_hold';
export const CANCEL_HOLD_DRAFT_TOOL = 'cancel_hold_draft';

/** The payload of the hold summary's confirm button. */
export const HOLD_CONFIRM_PAYLOAD = 'HOLD_CONFIRM';

/** The buttons under the hold summary; tapping one sends its title as text. */
export const HOLD_QUICK_REPLIES: readonly QuickReply[] = [
  { title: '✅ Giữ chỗ', payload: HOLD_CONFIRM_PAYLOAD },
  { title: '✏️ Sửa thông tin', payload: 'HOLD_EDIT' },
];

const Day = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const StayFields = {
  checkIn: Day,
  checkOut: Day,
  adults: z.number().int().min(0).max(500),
  childAges: z.array(z.number().int().min(0).max(17)).max(50).optional(),
};
/** At least one guest: adults may be 0 when children are given (as the lodging module). */
const someGuest = (v: { adults: number; childAges?: number[] | undefined }) =>
  v.adults + (v.childAges?.length ?? 0) >= 1;
const SOME_GUEST = { message: 'at least one guest', path: ['adults'] };
const PropertyCode = z.string().trim().min(1).max(40);

const CheckInput = z
  .object({ ...StayFields, propertyCode: PropertyCode.optional() })
  .refine(someGuest, SOME_GUEST);

const PrepareInput = z
  .object({
    ...StayFields,
    propertyCode: PropertyCode,
    rooms: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
    // Empty values are allowed: the server answers with `missing_*` problems the model can ask about.
    guestName: z.string().max(120),
    guestPhone: z.string().max(40),
    note: z.string().max(300).optional(),
    packages: z
      .array(
        z.object({
          room: z.string().trim().min(1).max(100).optional(),
          package: z.string().trim().min(1).max(50),
        }),
      )
      .max(30)
      .optional(),
  })
  .refine(someGuest, SOME_GUEST);

const CHECK_DEFINITION: ToolDefinition = {
  name: CHECK_AVAILABILITY_TOOL,
  description:
    "Checks the real booking calendar for a stay and quotes it. checkIn and checkOut are YYYY-MM-DD (checkOut is the departure day), adults counts adults, childAges lists each child's age. With propertyCode (the code from the catalog) checks that property and, when it is full, returns other free properties; without it lists the free properties. Returns nights, the weekday labels, and for each free option its code, rooms, whether the party fits the standard, the exact nightly prices with their weekday labels and the total (totalSell). requestedFull true means the asked property is not free for those dates; problems explain dates or a party the server cannot quote.",
  input: CheckInput,
};

const PREPARE_DEFINITION: ToolDefinition = {
  name: PREPARE_HOLD_TOOL,
  description:
    'Prepares a hold once the customer wants to keep a free option from check_availability and gave their name and phone. propertyCode is the option\'s code; rooms are the option\'s room names (omit them to hold the whole property). packages is optional: only when the customer chose a bedroom package other than the option\'s package, give [{room, package}] with a name from the option\'s package or alternatives (omit room for the whole property); unknown_package answers the valid names. The server checks the calendar again, computes the total and sends the customer the summary with "Giữ chỗ" / "Sửa thông tin" buttons; never restate the summary. Returns problems to ask the customer about (with alternatives when the option is gone), or that the hold waits for the customer to confirm.',
  input: PrepareInput,
};

const CONFIRM_DEFINITION: ToolDefinition = {
  name: CONFIRM_HOLD_TOOL,
  description:
    'The customer agreed to the hold summary sent earlier ("Giữ chỗ", "ok", "chốt"): places the hold exactly as summarised and returns its code and until when it is held. Staff call the customer to confirm the booking. If another booking took the nights since the summary (ok false), apologise that it was just taken, then offer the alternatives it returns.',
  input: z.object({}),
};

const CANCEL_DEFINITION: ToolDefinition = {
  name: CANCEL_HOLD_DRAFT_TOOL,
  description:
    'The customer wants to change or drop the hold summary sent earlier: discards it. To change something, prepare the hold again with the new details.',
  input: z.object({}),
};

/** What one turn's lodging tools need; built by the reply pipeline only for hotel bots. */
export interface HoldToolContext {
  facade: LodgingBotFacade;
  /** Maps the property code the model saw to its id. */
  catalog: LodgingCatalogFacade;
  ws: WorkspaceId;
  botId: string;
  /** A UUID: the real conversation, or the stable per-bot playground id. */
  conversationId: string;
  /** The conversation's channel (the booking links the conversation for customer channels). */
  channel: string;
  /** The conversation's contact, linked to the hold; null when unknown (playground). */
  contactId: string | null;
  /** Every property id the bot sells: resolves a code the catalog search misses (no cap). */
  propertyIds?: () => Promise<string[]>;
  /** Absent: the summary is collected (playground), like `send_message`. */
  sink?: MessageSink;
  output: OutputState;
  /** The bot may place holds (the bot's order-taking switch, in a private conversation). */
  takesHolds: boolean;
  /** A draft stored before the customer's newest message: the only one this turn can confirm or cancel. */
  confirmable: boolean;
  state: HoldToolState;
  /** Logs a failure the turn survives (the error class only). */
  onError?: (error: unknown) => void;
}

export interface HoldToolState {
  /** A draft was stored this turn: it cannot be confirmed in the same turn. */
  stored: boolean;
  /** A summary send was attempted this turn: a second one is refused (no duplicate summaries). */
  summarySent: boolean;
  /** A summary was not (fully) delivered this turn: the next turn may prepare it again. */
  undelivered: boolean;
  /** Dropping a draft failed: its state is unknown, so confirm / cancel are off for this turn. */
  draftUnknown: boolean;
  /** `confirm_hold` placed a hold this turn: its code must reach the customer. */
  created: { code: string; expiresAt: string } | null;
}

export const newHoldToolState = (): HoldToolState => ({
  stored: false,
  summarySent: false,
  undelivered: false,
  draftUnknown: false,
  created: null,
});

const LOCAL_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: SHOP_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  hourCycle: 'h23',
});

/** '16:30 01/11': the shop's local time and day of an ISO instant; null when it is not one. */
export function localHoldTime(iso: string): { time: string; day: string } | null {
  const at = new Date(iso);
  if (!iso || Number.isNaN(at.getTime())) return null;
  const parts = Object.fromEntries(LOCAL_TIME.formatToParts(at).map((p) => [p.type, p.value]));
  return { time: `${parts.hour}:${parts.minute}`, day: `${parts.day}/${parts.month}` };
}

/** The line that tells the customer the hold's code and until when it is held (when known). */
export function holdCreatedText(code: string, expiresAt: string): string {
  const until = localHoldTime(expiresAt);
  const when = until ? ` đến ${until.time} ngày ${until.day}` : '';
  return `Dạ em đã giữ chỗ ${code}${when} ạ. Nhân viên sẽ gọi xác nhận sớm ạ.`;
}

const reply = (value: unknown, ok = true) => ({ content: safeJson(value), ok });

/** An option as the model sees it: no property or room ids, room names as `rooms`. */
function optionView(option: BotAvailabilityOption) {
  const { propertyId: _p, unitIds: _u, unitNames, ...rest } = option;
  return { ...rest, rooms: unitNames };
}

const isValidationFailure = (error: unknown): boolean =>
  error instanceof DomainError && (error as { code?: unknown }).code === 'VALIDATION_FAILED';

/** A rejected stay (bad dates or party) the lodging module reports by throwing. */
const INVALID_REQUEST = { ok: false, problems: ['invalid_request'] };

/** The catalog search's row cap; also the bound of the exact-code candidates it returns. */
const SEARCH_LIMIT = 300;
/** `getBotProductsByIds` reads at most this many ids per call. */
const ID_PAGE = 10;

/**
 * The property id of a catalog code (case-insensitive exact match). The catalog search matches the
 * code against every property the bot sells; when it misses (more than SEARCH_LIMIT partial
 * matches), the bot's property ids are paged through, so the lookup has no cap.
 */
async function propertyIdOf(ctx: HoldToolContext, code: string): Promise<string | null> {
  const wanted = code.trim().toLowerCase();
  const scope = { botId: ctx.botId };
  const matches = (rows: { id: string; code?: string | null }[]) =>
    rows.find((p) => (p.code ?? '').trim().toLowerCase() === wanted)?.id ?? null;
  const found = matches(
    await ctx.catalog.searchBotCatalog(ctx.ws, scope, { query: code, limit: SEARCH_LIMIT }),
  );
  if (found || !ctx.propertyIds) return found;
  const ids = await ctx.propertyIds();
  for (let i = 0; i < ids.length; i += ID_PAGE) {
    const page = matches(
      await ctx.catalog.getBotProductsByIds(ctx.ws, scope, ids.slice(i, i + ID_PAGE)),
    );
    if (page) return page;
  }
  return null;
}

const stayOf = (args: z.infer<typeof CheckInput>) => ({
  checkIn: args.checkIn,
  checkOut: args.checkOut,
  adults: args.adults,
  childAges: args.childAges ?? [],
});

/**
 * `check_availability` (read-only) for every hotel bot; `prepare_hold` when the bot takes holds,
 * plus `confirm_hold` / `cancel_hold_draft` while a draft from an earlier turn waits. The model
 * never sets a price, and confirming never reads its arguments.
 */
export function holdTools(ctx: HoldToolContext): {
  definitions: ToolDefinition[];
  runnable: RunnableTool[];
} {
  const { facade, ws, conversationId, state } = ctx;
  const dropDraft = async (): Promise<void> => {
    try {
      await facade.cancelBotHoldDraft(ws, { conversationId });
      state.stored = false;
    } catch (error) {
      state.draftUnknown = true;
      ctx.onError?.(error);
    }
  };
  const draftOpen = (): boolean => ctx.confirmable && !state.stored && !state.draftUnknown;

  const check: RunnableTool = {
    name: CHECK_AVAILABILITY_TOOL,
    readOnly: true,
    schema: CheckInput,
    run: async (input) => {
      const args = input as z.infer<typeof CheckInput>;
      let propertyId: string | undefined;
      if (args.propertyCode) {
        const id = await propertyIdOf(ctx, args.propertyCode);
        if (!id) return reply({ ok: false, error: 'unknown_property_code' }, false);
        propertyId = id;
      }
      let res;
      try {
        res = await facade.checkAvailabilityForBot(ws, {
          botId: ctx.botId,
          ...stayOf(args),
          ...(propertyId ? { propertyId } : {}),
        });
      } catch (error) {
        if (isValidationFailure(error)) return reply(INVALID_REQUEST, false);
        throw error;
      }
      const ok = res.problems.length === 0 || res.options.length > 0;
      return {
        ...reply({ ok, ...res, options: res.options.map(optionView) }, ok),
        productIds: [...new Set(res.options.map((o) => o.propertyId))],
      };
    },
  };

  const prepare: RunnableTool = {
    name: PREPARE_HOLD_TOOL,
    readOnly: false,
    schema: PrepareInput,
    run: async (input) => {
      const args = input as z.infer<typeof PrepareInput>;
      // One summary per turn; no summary after a placed hold (it would hide the code line).
      if (state.created) return reply({ ok: false, error: 'hold_created_retry_next_turn' }, false);
      if (state.summarySent)
        return reply(
          {
            ok: false,
            error: state.undelivered ? 'not_delivered_retry_next_turn' : 'already_sent',
          },
          false,
        );
      const propertyId = await propertyIdOf(ctx, args.propertyCode);
      if (!propertyId) return reply({ ok: false, error: 'unknown_property_code' }, false);
      const whole = !args.rooms?.length;
      let res;
      try {
        const rooms = await resolveRooms(ctx, { ...args, ...stayOf(args) }, propertyId);
        if ('unknown' in rooms)
          return reply({ ok: false, error: 'unknown_room', rooms: rooms.unknown }, false);
        const unitIds = rooms.ids;
        res = await facade.prepareBotHold(ws, {
          botId: ctx.botId,
          conversationId,
          channel: ctx.channel,
          contactId: ctx.contactId,
          propertyId,
          whole,
          unitIds,
          ...stayOf(args),
          guestName: args.guestName,
          guestPhone: args.guestPhone,
          ...(args.note?.trim() ? { note: args.note.trim() } : {}),
          ...(rooms.packages.length ? { packages: rooms.packages } : {}),
        });
      } catch (error) {
        if (isValidationFailure(error)) return reply(INVALID_REQUEST, false);
        throw error;
      }
      if (res.status !== 'ready')
        return reply(
          {
            ok: false,
            problems: res.problems,
            alternatives: res.alternatives.map(optionView),
            ...(res.validPackages ? { valid: res.validPackages } : {}),
          },
          false,
        );
      state.stored = true;
      // The server, not the model, delivers the summary with the confirm / edit buttons.
      const message: OutgoingMessage = {
        text: res.summary,
        images: [],
        quickReplies: HOLD_QUICK_REPLIES.map((q) => ({ ...q })),
      };
      state.summarySent = true;
      let sent: { delivered: number; complete?: boolean } = { delivered: 1 };
      try {
        if (ctx.sink) sent = await ctx.sink.send(message);
      } catch (error) {
        state.undelivered = true;
        await dropDraft();
        throw error;
      }
      if (sent.delivered <= 0 || sent.complete === false) {
        // The customer never saw the whole summary: their next "ok" must not confirm it.
        state.undelivered = true;
        await dropDraft();
        return reply({ ok: false, error: 'not_delivered' }, false);
      }
      ctx.output.sent.push({
        text: res.summary,
        images: [],
        quickReplies: message.quickReplies ?? [],
        via: 'send_message',
      });
      return {
        ...reply({
          ok: true,
          status: 'awaiting_customer_confirmation',
          holdMinutes: res.holdMinutes,
        }),
        productIds: [propertyId],
      };
    },
  };

  const confirm: RunnableTool = {
    name: CONFIRM_HOLD_TOOL,
    readOnly: false,
    schema: z.object({}),
    // Never the model's arguments: only the draft the customer was shown.
    run: async () => {
      if (!draftOpen()) return reply({ ok: false, code: 'not_confirmable' }, false);
      const res = await facade.confirmBotHold(ws, { conversationId });
      if (res.status !== 'held')
        return reply(
          { ok: false, status: res.status, alternatives: res.alternatives.map(optionView) },
          false,
        );
      state.created = { code: res.code, expiresAt: res.holdExpiresAt };
      const until = localHoldTime(res.holdExpiresAt);
      return reply({
        ok: true,
        code: res.code,
        ...(until ? { heldUntil: `${until.time} ${until.day}` } : {}),
      });
    },
  };

  const cancel: RunnableTool = {
    name: CANCEL_HOLD_DRAFT_TOOL,
    readOnly: false,
    schema: z.object({}),
    run: async () => {
      if (!draftOpen()) return reply({ ok: false, code: 'nothing_pending' }, false);
      try {
        await facade.cancelBotHoldDraft(ws, { conversationId });
      } catch (error) {
        state.draftUnknown = true;
        throw error;
      }
      return reply({ ok: true, status: 'cancelled' });
    },
  };

  if (!ctx.takesHolds) return { definitions: [CHECK_DEFINITION], runnable: [check] };
  return ctx.confirmable
    ? {
        definitions: [CHECK_DEFINITION, PREPARE_DEFINITION, CONFIRM_DEFINITION, CANCEL_DEFINITION],
        runnable: [check, prepare, confirm, cancel],
      }
    : { definitions: [CHECK_DEFINITION, PREPARE_DEFINITION], runnable: [check, prepare] };
}

/**
 * The lodging tools' context of a hotel bot's turn: `check_availability` always; holds only with
 * the order-taking switch in a private conversation (never a public comment reply), and confirm /
 * cancel only for a draft the customer answered.
 */
export async function hotelHoldContext(input: {
  facade: LodgingBotFacade;
  catalog: LodgingCatalogFacade;
  ws: WorkspaceId;
  bot: { id: string; orderTaking?: boolean };
  conversationId: string;
  channel: string;
  contactId: string | null;
  /** Lists every property the bot sells (code lookup without a cap). */
  lodging?: LodgingFacade;
  sink?: MessageSink;
  output: OutputState;
  privateChat: boolean;
  answered: (storedAt: Date) => boolean;
  /** Logs a line; failures carry the error class only. */
  warn: (message: string) => void;
}): Promise<HoldToolContext> {
  const { facade, ws, conversationId, lodging } = input;
  const errorName = (error: unknown) => (error instanceof Error ? error.name : 'unknown error');
  const takesHolds = input.bot.orderTaking === true && input.privateChat;
  return {
    facade,
    catalog: input.catalog,
    ws,
    botId: input.bot.id,
    conversationId,
    channel: input.channel,
    contactId: input.contactId,
    ...(lodging ? { propertyIds: () => lodging.listBotPropertyIds(ws, input.bot.id) } : {}),
    ...(input.sink ? { sink: input.sink } : {}),
    output: input.output,
    takesHolds,
    confirmable:
      takesHolds &&
      (await confirmableDraft(
        (w, id) => facade.hasBotHoldDraft(w, id),
        ws,
        conversationId,
        input.answered,
        (error) => input.warn(`Hold draft check failed: ${errorName(error)}`),
      )),
    state: newHoldToolState(),
    onError: (error) => input.warn(`Hold draft drop failed: ${errorName(error)}`),
  };
}
