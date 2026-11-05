import { isUuid, newId, normalizeVnPhone, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { BOT_FACADE, type BotFacade } from '../../bot/api/index.js';
import type {
  BotAvailabilityInput,
  BotAvailabilityOption,
  BotAvailabilityResult,
  ConfirmBotHoldResult,
  HoldProblem,
  LodgingBotFacade,
  PrepareBotHoldInput,
  PrepareBotHoldResult,
} from '../api/lodging.facade.js';
import { botStayProblems, rankForBot } from '../domain/availability-ranking.js';
import { buildHoldSummary, weekdayLabel } from '../domain/hold-summary.js';
import { LodgingError, LodgingUnavailableError } from '../domain/lodging.errors.js';
import { localToday } from '../domain/nights.js';
import { quoteStay, resolveUnits, type Quote } from '../domain/quote.js';
import { freeOptions, type StayAsk } from './availability.js';
import { BookingService } from './booking.service.js';
import { expireHolds } from './booking-support.js';
import {
  BOT_HOLD_DRAFT_TTL_MS,
  CUSTOMER_CHANNELS,
  held,
  holdRequestId,
  HoldNotConfirmable,
  MAX_NAME,
  MAX_NOTE,
  NightsTakenOnConfirm,
  quoteHash,
  stayOf,
  tidy,
  toBotOption,
  validParty,
  type FailCode,
  packagesOfProperty,
  type SoldContext,
} from './bot-hold-support.js';
import { toBotProduct } from './bot-product.js';
import {
  LODGING_STORE,
  type BookingRecord,
  type BotHoldDraftRecord,
  type LodgingStore,
  type LodgingTx,
} from './ports/lodging-store.js';

/** Problems of the input itself: nothing else is checked. */
const INPUT_PROBLEMS: ReadonlySet<HoldProblem> = new Set([
  'invalid_dates',
  'invalid_party',
  'past_date',
  'too_long',
]);

/**
 * The bot's calendar use cases (`LODGING_BOT_FACADE`, spec T-161 §3): availability and quotes
 * for the properties the bot sells, hold drafts the customer confirms, and the hold itself,
 * created through the staff create path (`BookingService.createIn`). The bot never confirms.
 */
@Injectable()
export class LodgingBotHolds implements LodgingBotFacade {
  constructor(
    @Inject(LODGING_STORE) private readonly store: LodgingStore,
    @Inject(BookingService) private readonly bookings: BookingService,
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
  ) {}

  async checkAvailabilityForBot(
    ws: WorkspaceId,
    input: BotAvailabilityInput,
  ): Promise<BotAvailabilityResult> {
    const now = new Date();
    // Throws NOT_FOUND for a bot of another workspace (not the customer's input).
    const bot = await this.bots.getBot(ws, input.botId);
    const { nights, problems } = botStayProblems(input.checkIn, input.checkOut, localToday(now));
    const datesOk = !problems.includes('invalid_dates');
    const result: BotAvailabilityResult = {
      nights,
      checkInWeekdayLabel: datesOk ? weekdayLabel(input.checkIn) : '',
      checkOutWeekdayLabel: datesOk ? weekdayLabel(input.checkOut) : '',
      requestedFull: false,
      options: [],
      problems: validParty(input.adults, input.childAges)
        ? problems
        : [...problems, 'invalid_party'],
    };
    if (result.problems.length) return result;
    return this.store.run(ws, async (tx) => {
      await expireHolds(tx, now);
      const ctx = await this.#sold(tx, bot.id, now);
      const sold =
        input.propertyId === undefined || ctx.sold.some((p) => p.id === input.propertyId);
      const options = await this.#options(tx, ctx, input);
      if (!sold) return { ...result, options: rankForBot(options).options, problems: ['not_sold'] };
      return { ...result, ...rankForBot(options, input.propertyId) };
    });
  }

  async prepareBotHold(ws: WorkspaceId, input: PrepareBotHoldInput): Promise<PrepareBotHoldResult> {
    if (!isUuid(input.conversationId)) throw new TypeError('conversationId must be a uuid');
    const contactId = input.contactId && isUuid(input.contactId) ? input.contactId : null;
    const now = new Date();
    const problems: HoldProblem[] = [];
    const guestName = tidy(input.guestName, MAX_NAME);
    const rawPhone = (input.guestPhone ?? '').trim();
    const e164 = rawPhone ? normalizeVnPhone(rawPhone) : null;
    if (!guestName) problems.push('missing_name');
    if (!rawPhone) problems.push('missing_phone');
    else if (!e164) problems.push('invalid_phone');
    const stay = botStayProblems(input.checkIn, input.checkOut, localToday(now));
    problems.push(...stay.problems);
    if (!validParty(input.adults, input.childAges)) problems.push('invalid_party');
    if (problems.some((p) => INPUT_PROBLEMS.has(p))) {
      return { status: 'problems', problems, alternatives: [] };
    }
    // Throws NOT_FOUND for a bot of another workspace.
    const bot = await this.bots.getBot(ws, input.botId);

    return this.store.run(ws, async (tx) => {
      await expireHolds(tx, now);
      await tx.sweepBotHoldDrafts(now);
      const ctx = await this.#sold(tx, bot.id, now);
      const property = ctx.sold.find((p) => p.id === input.propertyId);
      const whole = input.whole || property?.sellMode === 'whole';
      const unitIds = whole ? [] : [...new Set(input.unitIds ?? [])];
      let quote: Quote | null = null;
      let resolved: string[] = [];
      if (!property) {
        problems.push('not_sold');
      } else {
        const units = ctx.units.filter((u) => u.propertyId === property.id);
        const rates = ctx.ratesOf.get(property.id) ?? [];
        const selection = { whole, unitIds };
        try {
          resolved = resolveUnits(property, units, selection);
          quote = quoteStay(
            property,
            units,
            rates,
            { ...selection, ...stayOf(input) },
            packagesOfProperty(ctx, property.id),
          );
        } catch (error) {
          if (!(error instanceof LodgingError)) throw error;
          problems.push('not_available');
        }
        if (quote) {
          const taken = await tx.takenNights(resolved, input.checkIn, input.checkOut);
          if (taken.length) problems.push('not_available');
          else if (quote.warnings.includes('min_nights')) problems.push('min_nights');
          if (quote.warnings.includes('over_max')) problems.push('over_max');
          if (quote.totalSell === null) problems.push('missing_rate');
        }
      }
      if (problems.length || !quote || quote.totalSell === null || !e164 || !property) {
        // A stale selection must not stay confirmable once the customer changed something.
        await tx.deleteBotHoldDraft(input.conversationId);
        const needsAlternatives = problems.some((p) =>
          ['not_available', 'not_sold', 'over_max', 'min_nights'].includes(p),
        );
        const alternatives = needsAlternatives
          ? rankForBot(
              (await this.#options(tx, ctx, input)).filter(
                (o) => o.propertyId !== input.propertyId,
              ),
            ).options
          : [];
        return { status: 'problems', problems, alternatives };
      }

      const guestPhone = `0${e164.slice(3)}`;
      const note = tidy(input.note, MAX_NOTE);
      const draft: BotHoldDraftRecord = {
        id: newId(),
        conversationId: input.conversationId,
        botId: bot.id,
        botName: bot.name,
        channel: input.channel,
        contactId,
        propertyId: property.id,
        whole,
        unitIds,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        adults: input.adults,
        childAges: input.childAges,
        guestName,
        guestPhone,
        note,
        quoteHash: '',
        createdAt: now,
        expiresAt: new Date(now.getTime() + BOT_HOLD_DRAFT_TTL_MS),
      };
      draft.quoteHash = quoteHash(draft, resolved, quote);
      await tx.saveBotHoldDraft(draft);
      const { holdMinutes } = await tx.settings();
      const names = new Map(ctx.units.map((u) => [u.id, u.name]));
      return {
        status: 'ready',
        holdMinutes,
        summary: buildHoldSummary({
          propertyName: property.name,
          whole,
          unitNames: resolved.map((id) => names.get(id) ?? ''),
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          adults: input.adults,
          childAges: input.childAges,
          totalSell: quote.totalSell,
          guestName,
          guestPhone,
          holdMinutes,
          note,
        }),
      };
    });
  }

  async confirmBotHold(
    ws: WorkspaceId,
    input: { conversationId: string },
  ): Promise<ConfirmBotHoldResult> {
    if (!isUuid(input.conversationId)) return { status: 'no_draft', alternatives: [] };
    let failed: { code: FailCode; draft: BotHoldDraftRecord };
    try {
      return await this.store.run(ws, (tx) => this.#confirm(tx, input.conversationId));
    } catch (error) {
      if (error instanceof HoldNotConfirmable) failed = error;
      else if (error instanceof NightsTakenOnConfirm)
        failed = { code: 'not_available', draft: error.draft };
      else throw error;
    }
    // Rolled back (no booking, no code used). The draft that can no longer become the hold it
    // showed is dropped (only that version: a newer prepare wins) in its own transaction, which
    // also computes what the bot may offer instead.
    const alternatives = await this.store.run(ws, async (tx) => {
      const now = new Date();
      await tx.deleteBotHoldDraft(failed.draft.conversationId, failed.draft.id);
      // Check-in has passed since the summary: nothing to offer for those dates.
      if (failed.draft.checkIn < localToday(now)) return [];
      await expireHolds(tx, now);
      const ctx = await this.#sold(tx, failed.draft.botId, now);
      const options = await this.#options(tx, ctx, failed.draft);
      // Expired or re-priced: the same property again (new price) while it is free, else others.
      return failed.code === 'not_available'
        ? rankForBot(options.filter((o) => o.propertyId !== failed.draft.propertyId)).options
        : rankForBot(options, failed.draft.propertyId).options;
    });
    return { status: failed.code, alternatives };
  }

  /**
   * Lock order, as the staff create path after it: the draft row, then the request key, the
   * booking code and the unit rows (`createIn`). Every failure throws so the transaction rolls
   * back.
   */
  async #confirm(tx: LodgingTx, conversationId: string): Promise<ConfirmBotHoldResult> {
    const now = new Date();
    await expireHolds(tx, now);
    // Locked: a second confirmation of this draft waits, then replays the hold.
    const draft = await tx.botHoldDraft(conversationId, true);
    if (!draft) return { status: 'no_draft', alternatives: [] };
    // A confirmed draft stays as a tombstone until its TTL (then it is dropped like any expired
    // draft): its deterministic request id finds the hold again, so a retried confirm answers
    // the same code while that booking is still a hold. A hold staff already handled, or that
    // lapsed, is not replayed.
    const clientRequestId = holdRequestId(draft.id);
    const existing = await tx.findBookingByRequest(clientRequestId);
    if (existing) {
      if (draft.expiresAt > now && existing.status === 'hold' && existing.holdExpiresAt) {
        return held(existing);
      }
      throw new HoldNotConfirmable('expired', draft);
    }
    if (draft.expiresAt <= now || draft.checkIn < localToday(now)) {
      throw new HoldNotConfirmable('expired', draft);
    }
    const ctx = await this.#sold(tx, draft.botId, now);
    const property = ctx.sold.find((p) => p.id === draft.propertyId);
    if (!property) throw new HoldNotConfirmable('not_available', draft);
    const units = ctx.units.filter((u) => u.propertyId === property.id);
    let quote: Quote;
    let resolved: string[];
    try {
      resolved = resolveUnits(property, units, draft);
      quote = quoteStay(
        property,
        units,
        ctx.ratesOf.get(property.id) ?? [],
        { whole: draft.whole, unitIds: draft.unitIds, ...stayOf(draft) },
        packagesOfProperty(ctx, property.id),
      );
    } catch (error) {
      if (error instanceof LodgingError) throw new HoldNotConfirmable('not_available', draft);
      throw error;
    }
    if (quoteHash(draft, resolved, quote) !== draft.quoteHash) {
      throw new HoldNotConfirmable('price_changed', draft);
    }
    let booking: BookingRecord;
    try {
      booking = await this.bookings.createIn(
        tx,
        {
          kind: 'stay',
          clientRequestId,
          propertyId: draft.propertyId,
          whole: draft.whole,
          unitIds: draft.unitIds,
          // Auto-picked again by the booking quote, as in the summary the customer saw.
          packageIds: [],
          checkIn: draft.checkIn,
          checkOut: draft.checkOut,
          status: 'hold',
          party: { adults: draft.adults, childAges: draft.childAges },
          guestName: draft.guestName,
          guestPhone: draft.guestPhone,
          source: 'bot',
          contactId: draft.contactId,
          conversationId: CUSTOMER_CHANNELS.has(draft.channel) ? draft.conversationId : null,
          adjustment: 0,
          adjustmentReason: '',
          manualTotalSell: null,
          note: draft.note,
          tags: [],
        },
        { id: null, name: draft.botName || null },
        now,
      );
    } catch (error) {
      if (error instanceof LodgingError && error.code === 'NIGHTS_TAKEN') {
        throw new NightsTakenOnConfirm(draft);
      }
      throw error;
    }
    return held(booking);
  }

  async cancelBotHoldDraft(ws: WorkspaceId, input: { conversationId: string }): Promise<void> {
    if (!isUuid(input.conversationId)) return;
    try {
      await this.store.run(ws, (tx) => tx.deleteBotHoldDraft(input.conversationId));
    } catch (error) {
      if (!(error instanceof LodgingUnavailableError)) throw error;
    }
  }

  async hasBotHoldDraft(
    ws: WorkspaceId,
    conversationId: string,
  ): Promise<{ pending: boolean; storedAt: Date | null }> {
    const none = { pending: false, storedAt: null };
    if (!isUuid(conversationId)) return none;
    try {
      return await this.store.run(ws, async (tx) => {
        const draft = await tx.botHoldDraft(conversationId);
        if (!draft) return none;
        if (draft.expiresAt <= new Date()) {
          // Past its TTL (open or confirmed): the guest's name and phone are not kept longer.
          await tx.deleteBotHoldDraft(conversationId, draft.id);
          return none;
        }
        // A confirmed draft (tombstone) is no longer pending.
        if (await tx.findBookingByRequest(holdRequestId(draft.id))) return none;
        return { pending: true, storedAt: draft.createdAt };
      });
    } catch (error) {
      if (error instanceof LodgingUnavailableError) return none;
      throw error;
    }
  }

  /**
   * The bot's properties: its selection (lodging_bot_properties; no rows = every property),
   * active and fully priced — the same rule as the bot catalog.
   */
  async #sold(tx: LodgingTx, botId: string, now: Date): Promise<SoldContext> {
    const selected = await tx.botPropertyIds(botId);
    const props = await tx.properties({ ...(selected ? { ids: selected } : {}), activeOnly: true });
    const pids = props.map((p) => p.id);
    const units = pids.length ? await tx.units(pids) : [];
    const ratesOf = pids.length ? await tx.ratesByProperty(pids) : new Map();
    const packages = await tx.packages(pids);
    const today = localToday(now);
    const sold = props.filter((p) =>
      toBotProduct(
        p,
        units,
        ratesOf.get(p.id) ?? [],
        today,
        packages.filter((pk) => pk.propertyId === p.id),
      ),
    );
    return { sold, units, ratesOf, packages };
  }

  /** Free options of the sold properties, as the bot sees them (a min-stay breach is flagged). */
  async #options(tx: LodgingTx, ctx: SoldContext, ask: StayAsk): Promise<BotAvailabilityOption[]> {
    const free = await freeOptions(tx, ctx.sold, stayOf(ask), ctx);
    return free.map((o) => toBotOption(o, ctx.ratesOf.get(o.property.id) ?? []));
  }
}
