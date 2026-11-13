import type { ProductDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** PUBLIC CONTRACT of the lodging module. Use-case shaped, returns DTOs from packages/contracts. */
export interface LodgingFacade {
  /** The properties a bot sells: its stored selection, or every active property when it has none. */
  listBotPropertyIds(workspaceId: WorkspaceId, botId: string): Promise<string[]>;
  /**
   * Revenue of the stays checking in on the local nights `from`..`to` (inclusive, `YYYY-MM-DD`):
   * confirmed, checked-in and checked-out stays, blocks excluded. For scheduled reports; no
   * guest data. Money is integer VND.
   */
  stayRevenue(workspaceId: WorkspaceId, range: { from: string; to: string }): Promise<StayRevenue>;
  /**
   * When the newest stay booking (held, confirmed, checked in or out) of each of these
   * conversations was created; conversations without one are absent. At most 1 000 ids. For the
   * Business Brain's Today ("ready" ends once a booking exists).
   */
  latestBookingTimes(
    workspaceId: WorkspaceId,
    conversationIds: readonly string[],
  ): Promise<{ conversationId: string; at: Date }[]>;
  /**
   * Stay bookings linked to a conversation (held, confirmed, checked in or out) created in
   * `[since, until)`, or only those of `bookingIds` when given (≤ 1 000): id, conversation,
   * creation time, sell total (integer VND, 0 when not priced) and status, oldest first, at most
   * 5 000. For the care agent's stop rules and attribution; no guest data.
   */
  conversationBookings(
    workspaceId: WorkspaceId,
    q: { since: Date; until: Date; bookingIds?: readonly string[] | undefined },
  ): Promise<ConversationBooking[]>;
}

/** A stay booking made in a conversation. */
export interface ConversationBooking {
  bookingId: string;
  conversationId: string;
  createdAt: Date;
  total: number;
  status: string;
}

export interface StayRevenue {
  bookings: number;
  nights: number;
  revenue: number;
  /** revenue − cost of those stays. */
  profit: number;
}

export const LODGING_FACADE = Symbol('LODGING_FACADE');

/** The bot whose catalog is read; any other field (e.g. the commerce `catalogMode`) is ignored. */
export interface LodgingBotScope {
  botId: string;
}

/**
 * The bot catalog of a hotel business, read from lodging properties (T-160). Same method shapes as
 * the commerce `CatalogFacade`, so the `ai` module uses it in its place for hotel bots. Each active
 * property the bot sells (lodging_bot_properties; no rows = every active property) is one
 * `ProductDto` with `id` = property id and an `accommodation` built from the property. Only sell
 * prices: never a cost. A property whose weekdays are not all priced is left out.
 */
export interface LodgingCatalogFacade {
  /** Accent-insensitive match on code, name, area and amenities; `inStockOnly` is ignored. */
  searchBotCatalog(
    workspaceId: WorkspaceId,
    bot: LodgingBotScope,
    input: { query?: string; maxPriceVnd?: number; inStockOnly?: boolean; limit: number },
  ): Promise<ProductDto[]>;
  /** Properties for these ids, in the order of `ids`; unknown or out-of-scope ids are skipped (max 10). */
  getBotProductsByIds(
    workspaceId: WorkspaceId,
    bot: LodgingBotScope,
    ids: readonly string[],
  ): Promise<ProductDto[]>;
  countBotCatalog(workspaceId: WorkspaceId, bot: LodgingBotScope): Promise<number>;
}

export const LODGING_CATALOG_FACADE = Symbol('LODGING_CATALOG_FACADE');

// ── Bot availability and holds (T-161, spec 2026-11-01-bot-lodging-holds §3) ─────────────────

export interface BotAvailabilityInput {
  botId: string;
  /** 'YYYY-MM-DD' local dates; check-out exclusive. */
  checkIn: string;
  checkOut: string;
  adults: number;
  childAges: number[];
  propertyId?: string;
  /**
   * VL3-1: the conversation and the codes of the bot's earlier holds in it (as for
   * `prepareBotHold`): the guest's own live holds do not make their property look taken.
   */
  conversationId?: string;
  channel?: string;
  earlierHolds?: string[];
}

/** One free option, in sell prices only (never a cost, the internal note or night notes). */
export interface BotAvailabilityOption {
  propertyId: string;
  code: string;
  name: string;
  whole: boolean;
  /** The rooms of the option (`prepareBotHold` takes them back for a per-room hold). */
  unitIds: string[];
  /** Room names of a rooms property; empty for a property rented whole only. */
  unitNames: string[];
  /** No `overStandard` and nobody above the property's maximum. */
  fits: boolean;
  /**
   * Guests above the standard capacity that no surcharge covers (no surcharge price set, or
   * children above the standard with no child surcharge): staff must check. Always false when
   * the party is above the property's maximum (`fits` false): that option is not offered.
   */
  overStandard: boolean;
  /** The minimum stay this option needs when the asked nights are fewer, else null. */
  minNights: number | null;
  /** `min_nights`: the asked stay is shorter than a date-range price requires. */
  problems: 'min_nights'[];
  /** Null when some night has no price. */
  totalSell: number | null;
  /**
   * The bedroom package the quote picked (T-193): the smallest one that fits the party and is
   * sold every night; null when the option's target has no packages (or several targets have).
   */
  package: string | null;
  /** The other packages of that target, fewest bedrooms first, quoted for the same stay. */
  alternatives: {
    package: string;
    bedrooms: number;
    /** Null when the package is not sold on one of the nights. */
    totalSell: number | null;
    fits: boolean;
  }[];
  nightly: { date: string; weekdayLabel: string; label: string; sell: number }[];
  surcharges: {
    kind: 'extra_adult' | 'extra_child';
    persons: number;
    nights: number;
    sell: number;
  }[];
}

export interface BotAvailabilityResult {
  nights: number;
  /** Vietnamese weekday of check-in / check-out ('Thứ Sáu', 'Chủ Nhật'). */
  checkInWeekdayLabel: string;
  checkOutWeekdayLabel: string;
  /** A `propertyId` was asked for and it is not free: `options` are alternatives. */
  requestedFull: boolean;
  /** Fitting first, then cheapest; at most 5. Never throws for the customer's input. */
  options: BotAvailabilityOption[];
  /** `invalid_dates` / `invalid_party`: the input could not be read (nothing else checked). */
  problems: ('invalid_dates' | 'invalid_party' | 'past_date' | 'too_long' | 'not_sold')[];
}

export interface PrepareBotHoldInput {
  botId: string;
  conversationId: string;
  contactId?: string | null;
  /** Conversation channel; only customer channels link the booking to the conversation. */
  channel: string;
  propertyId: string;
  whole: boolean;
  unitIds?: string[];
  checkIn: string;
  checkOut: string;
  adults: number;
  childAges: number[];
  guestName: string;
  guestPhone: string;
  note?: string;
  /**
   * Bedroom packages the customer chose by name (T-193), case-insensitive; `unitId` null = the
   * whole property. Targets left out get the package the quote picks.
   */
  packages?: { unitId: string | null; name: string }[];
  /**
   * Codes of the holds the bot placed earlier in this conversation (read from its own messages,
   * VL2-4). The one for the same property and guest phone is replaced: its nights do not block
   * the new stay and it is cancelled when the new hold is placed.
   */
  earlierHolds?: string[];
}

/** One hold the bot placed in this conversation, as the bot may restate it (VL2-5). */
export interface BotConversationHold {
  code: string;
  propertyCode: string;
  propertyName: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  childAges: number[];
  totalSell: number | null;
  /** `hold` (waiting for staff), `confirmed`, `cancelled`, `expired`, …. */
  status: string;
  /** ISO; null once it is no longer a hold. */
  holdExpiresAt: string | null;
}

export type HoldProblem =
  | 'invalid_dates'
  | 'invalid_party'
  | 'min_nights'
  | 'missing_name'
  | 'missing_phone'
  | 'invalid_phone'
  | 'not_available'
  | 'not_sold'
  | 'over_max'
  | 'missing_rate'
  | 'past_date'
  | 'too_long'
  /** A package name that is not one of the target's (`validPackages` lists them). */
  | 'unknown_package'
  /** The chosen package is not sold on some night of the stay. */
  | 'package_unavailable';

export type PrepareBotHoldResult =
  | {
      status: 'ready';
      summary: string;
      holdMinutes: number;
      /** The earlier hold of this conversation the new one replaces (VL2-4). */
      replaces?: string;
    }
  | {
      status: 'problems';
      problems: HoldProblem[];
      alternatives: BotAvailabilityOption[];
      /** With `unknown_package`: the package names of the stay's targets ('Bungalow 1: 2PN'). */
      validPackages?: string[];
    };

export type ConfirmBotHoldResult =
  | {
      status: 'held';
      code: string;
      holdExpiresAt: string;
      /** The earlier hold this one replaced, cancelled in the same transaction (VL2-4). */
      replaced?: string;
    }
  | {
      status: 'expired' | 'no_draft' | 'price_changed' | 'not_available';
      alternatives: BotAvailabilityOption[];
    };

/**
 * What the bot may do with the calendar (`ai` → `lodging`, ADR-019): read availability and quotes,
 * and place an expiring hold the customer agreed to. It never confirms a booking; staff do.
 */
export interface LodgingBotFacade {
  checkAvailabilityForBot(
    ws: WorkspaceId,
    input: BotAvailabilityInput,
  ): Promise<BotAvailabilityResult>;
  /** Validates, re-checks availability (no write to nights) and stores the conversation's draft. */
  prepareBotHold(ws: WorkspaceId, input: PrepareBotHoldInput): Promise<PrepareBotHoldResult>;
  /**
   * Turns the draft into a hold (source `bot`) when it is unexpired and its quote unchanged. A
   * retry of a confirmed draft answers the same hold (until the draft's 30 minutes are swept).
   */
  confirmBotHold(
    ws: WorkspaceId,
    input: { conversationId: string; earlierHolds?: string[] },
  ): Promise<ConfirmBotHoldResult>;
  /**
   * The holds the bot placed in this conversation among `codes` (its own messages name them):
   * source `bot`, linked to the conversation (a customer channel) or tagged `Chat thử` (the test
   * chat). Never a cost, note or tag.
   */
  botConversationHolds(
    ws: WorkspaceId,
    input: { conversationId: string; channel: string; codes: string[] },
  ): Promise<BotConversationHold[]>;
  cancelBotHoldDraft(ws: WorkspaceId, input: { conversationId: string }): Promise<void>;
  hasBotHoldDraft(
    ws: WorkspaceId,
    conversationId: string,
  ): Promise<{ pending: boolean; storedAt: Date | null }>;
}

export const LODGING_BOT_FACADE = Symbol('LODGING_BOT_FACADE');
