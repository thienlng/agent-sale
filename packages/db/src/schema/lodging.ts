import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenantPolicies, workspaces } from './workspace.js';

/**
 * Lodging v2 tables (migration 0041, T-160): properties → units → rates → bookings, with one
 * `lodging_unit_nights` row per occupied unit-night as the anti-double-booking key. Money is
 * bigint VND read as JS numbers; nights are local calendar dates ('YYYY-MM-DD' strings).
 * CHECK constraints live in the SQL migrations only (0041, 0042, 0043); 0066 reshapes `gallery` into folders.
 */
const money = (name: string) => bigint(name, { mode: 'number' });
const night = (name: string) => date(name, { mode: 'string' });
const ts = (name: string) => timestamp(name, { withTimezone: true });
const workspaceRef = () =>
  uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id);

export type LodgingSellMode = 'whole' | 'rooms';
export type LodgingPropertyStatus = 'active' | 'paused';
export type LodgingUnitKind = 'whole' | 'room';
export type LodgingRateKind = 'weekday' | 'override';
export type LodgingBookingKind = 'stay' | 'block';
export type LodgingBookingStatus =
  | 'hold'
  | 'confirmed'
  | 'checked_in'
  | 'checked_out'
  | 'cancelled'
  | 'expired'
  | 'no_show'
  | 'active'
  | 'removed';
export type LodgingBookingSource =
  'messenger' | 'zalo' | 'phone' | 'walk_in' | 'owner' | 'ota' | 'bot' | 'other';
/** One gallery entry (migration 0066): a product-picture path or https photo, a video, a link. */
export type LodgingGalleryItemJson = {
  kind: 'image' | 'video' | 'link';
  url: string;
  caption?: string;
};
export type LodgingGalleryFolderJson = {
  id: string;
  name: string;
  items: LodgingGalleryItemJson[];
};

export const lodgingProperties = pgTable(
  'lodging_properties',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    area: text('area').notNull().default(''),
    address: text('address').notNull().default(''),
    description: text('description').notNull().default(''),
    sellMode: text('sell_mode').notNull().$type<LodgingSellMode>(),
    status: text('status').notNull().default('active').$type<LodgingPropertyStatus>(),
    standardAdults: integer('standard_adults').notNull(),
    standardChildren: integer('standard_children').notNull().default(0),
    maxGuests: integer('max_guests'),
    childFreeBelow: integer('child_free_below').notNull().default(6),
    childAdultFrom: integer('child_adult_from').notNull().default(12),
    amenities: jsonb('amenities').$type<string[]>().notNull().default([]),
    layout: jsonb('layout')
      .$type<{ name: string; beds: string; note: string }[]>()
      .notNull()
      .default([]),
    policies: jsonb('policies').$type<Record<string, string>>().notNull().default({}),
    /** Media folders (0066). Rows copied later by `lodging_copy_accommodations()` may be flat. */
    gallery: jsonb('gallery').$type<LodgingGalleryFolderJson[]>().notNull().default([]),
    /** '' = automatic cover; else the url of an image item (0066). */
    galleryCover: text('gallery_cover').notNull().default(''),
    extraAdultSell: money('extra_adult_sell'),
    extraAdultCost: money('extra_adult_cost'),
    extraChildSell: money('extra_child_sell'),
    extraChildCost: money('extra_child_cost'),
    /** T-155 product this property was copied from by 0041; null for new properties. */
    sourceProductId: uuid('source_product_id'),
    /** Staff-only note (≤ 2000 chars, migration 0042); never reaches the bot. */
    internalNote: text('internal_note').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('lodging_properties_code_unique').on(t.workspaceId, t.code),
    unique('lodging_properties_ws_id').on(t.workspaceId, t.id),
    ...tenantPolicies('lodging_properties'),
  ],
);

export const lodgingUnits = pgTable(
  'lodging_units',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    propertyId: uuid('property_id').notNull(),
    kind: text('kind').notNull().$type<LodgingUnitKind>(),
    name: text('name').notNull(),
    beds: text('beds').notNull().default(''),
    capacityAdults: integer('capacity_adults').notNull().default(1),
    capacityChildren: integer('capacity_children').notNull().default(0),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    foreignKey({
      name: 'lodging_units_property_fk',
      columns: [t.workspaceId, t.propertyId],
      foreignColumns: [lodgingProperties.workspaceId, lodgingProperties.id],
    }).onDelete('cascade'),
    unique('lodging_units_ws_id').on(t.workspaceId, t.id),
    ...tenantPolicies('lodging_units'),
  ],
);

export const lodgingRates = pgTable(
  'lodging_rates',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    propertyId: uuid('property_id').notNull(),
    /** Null: the whole property; otherwise a room unit. */
    unitId: uuid('unit_id'),
    kind: text('kind').notNull().$type<LodgingRateKind>(),
    /** ISO weekday: Monday = 1, Sunday = 7. */
    weekdays: integer('weekdays')
      .array()
      .notNull()
      .default(sql`'{}'`),
    dateFrom: night('date_from'),
    dateTo: night('date_to'),
    label: text('label').notNull().default(''),
    sell: money('sell').notNull(),
    cost: money('cost').notNull(),
    minNights: integer('min_nights'),
  },
  (t) => [
    foreignKey({
      name: 'lodging_rates_property_fk',
      columns: [t.workspaceId, t.propertyId],
      foreignColumns: [lodgingProperties.workspaceId, lodgingProperties.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'lodging_rates_unit_fk',
      columns: [t.workspaceId, t.unitId],
      foreignColumns: [lodgingUnits.workspaceId, lodgingUnits.id],
    }).onDelete('cascade'),
    index('lodging_rates_property_idx').on(t.workspaceId, t.propertyId),
    ...tenantPolicies('lodging_rates'),
  ],
);

/** One row per workspace, created on first use. */
export const lodgingSettings = pgTable(
  'lodging_settings',
  {
    workspaceId: uuid('workspace_id')
      .primaryKey()
      .references(() => workspaces.id),
    holdMinutes: integer('hold_minutes').notNull().default(120),
    /** Last issued booking number; codes are 'BK-' + 4-digit zero-padded seq. */
    bookingSeq: integer('booking_seq').notNull().default(0),
  },
  () => [...tenantPolicies('lodging_settings')],
);

export const lodgingBookings = pgTable(
  'lodging_bookings',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    propertyId: uuid('property_id').notNull(),
    code: text('code').notNull(),
    kind: text('kind').notNull().$type<LodgingBookingKind>(),
    whole: boolean('whole').notNull(),
    status: text('status').notNull().$type<LodgingBookingStatus>(),
    checkIn: night('check_in').notNull(),
    checkOut: night('check_out').notNull(),
    adults: integer('adults').notNull().default(0),
    childAges: integer('child_ages')
      .array()
      .notNull()
      .default(sql`'{}'`),
    guestName: text('guest_name').notNull().default(''),
    guestPhone: text('guest_phone').notNull().default(''),
    contactId: uuid('contact_id'),
    conversationId: uuid('conversation_id'),
    source: text('source').$type<LodgingBookingSource>(),
    holdExpiresAt: ts('hold_expires_at'),
    quote: jsonb('quote').$type<Record<string, unknown>>(),
    adjustment: money('adjustment').notNull().default(0),
    adjustmentReason: text('adjustment_reason').notNull().default(''),
    totalSell: money('total_sell'),
    totalCost: money('total_cost'),
    note: text('note').notNull().default(''),
    blockReason: text('block_reason').notNull().default(''),
    /** Free-text labels (≤ 8, each ≤ 30 chars; migration 0042). */
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'`),
    clientRequestId: uuid('client_request_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    createdBy: uuid('created_by'),
    /** First staff status action or edit of a bot booking (migration 0043). */
    reviewedAt: ts('reviewed_at'),
    reviewedBy: uuid('reviewed_by'),
    version: integer('version').notNull().default(1),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'lodging_bookings_property_fk',
      columns: [t.workspaceId, t.propertyId],
      foreignColumns: [lodgingProperties.workspaceId, lodgingProperties.id],
    }),
    unique('lodging_bookings_code_unique').on(t.workspaceId, t.code),
    unique('lodging_bookings_request_unique').on(t.workspaceId, t.clientRequestId),
    unique('lodging_bookings_ws_id').on(t.workspaceId, t.id),
    index('lodging_bookings_dates_idx').on(t.workspaceId, t.propertyId, t.checkIn, t.checkOut),
    index('lodging_bookings_hold_idx')
      .on(t.workspaceId, t.holdExpiresAt)
      .where(sql`${t.status} = 'hold'`),
    index('lodging_bookings_tags_idx').using('gin', t.tags),
    index('lodging_bookings_conversation_idx')
      .on(t.workspaceId, t.conversationId)
      .where(sql`${t.conversationId} is not null`),
    index('lodging_bookings_review_idx')
      .on(t.workspaceId)
      .where(sql`${t.source} = 'bot' and ${t.status} = 'hold' and ${t.reviewedAt} is null`),
    ...tenantPolicies('lodging_bookings'),
  ],
);

export const lodgingBookingUnits = pgTable(
  'lodging_booking_units',
  {
    workspaceId: uuid('workspace_id').notNull(),
    bookingId: uuid('booking_id').notNull(),
    unitId: uuid('unit_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.bookingId, t.unitId] }),
    foreignKey({
      name: 'lodging_booking_units_booking_fk',
      columns: [t.workspaceId, t.bookingId],
      foreignColumns: [lodgingBookings.workspaceId, lodgingBookings.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'lodging_booking_units_unit_fk',
      columns: [t.workspaceId, t.unitId],
      foreignColumns: [lodgingUnits.workspaceId, lodgingUnits.id],
    }),
    ...tenantPolicies('lodging_booking_units'),
  ],
);

/** One row per occupied unit-night; the primary key is the anti-double-booking rule. */
export const lodgingUnitNights = pgTable(
  'lodging_unit_nights',
  {
    workspaceId: uuid('workspace_id').notNull(),
    unitId: uuid('unit_id').notNull(),
    night: night('night').notNull(),
    bookingId: uuid('booking_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.unitId, t.night] }),
    foreignKey({
      name: 'lodging_unit_nights_booking_fk',
      columns: [t.workspaceId, t.bookingId],
      foreignColumns: [lodgingBookings.workspaceId, lodgingBookings.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'lodging_unit_nights_unit_fk',
      columns: [t.workspaceId, t.unitId],
      foreignColumns: [lodgingUnits.workspaceId, lodgingUnits.id],
    }),
    index('lodging_unit_nights_booking_idx').on(t.workspaceId, t.bookingId),
    ...tenantPolicies('lodging_unit_nights'),
  ],
);

export const lodgingBotProperties = pgTable(
  'lodging_bot_properties',
  {
    workspaceId: uuid('workspace_id').notNull(),
    botId: uuid('bot_id').notNull(),
    propertyId: uuid('property_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.botId, t.propertyId] }),
    foreignKey({
      name: 'lodging_bot_properties_property_fk',
      columns: [t.workspaceId, t.propertyId],
      foreignColumns: [lodgingProperties.workspaceId, lodgingProperties.id],
    }).onDelete('cascade'),
    ...tenantPolicies('lodging_bot_properties'),
  ],
);

/**
 * Staff-only note on one night of a property (`unitId` null) or of one room (migration 0042).
 * Unique per (workspace, property, unit, night) with NULLS NOT DISTINCT.
 */
export const lodgingNightNotes = pgTable(
  'lodging_night_notes',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    propertyId: uuid('property_id').notNull(),
    unitId: uuid('unit_id'),
    night: night('night').notNull(),
    text: text('text').notNull(),
    updatedBy: uuid('updated_by'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'lodging_night_notes_property_fk',
      columns: [t.workspaceId, t.propertyId],
      foreignColumns: [lodgingProperties.workspaceId, lodgingProperties.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'lodging_night_notes_unit_fk',
      columns: [t.workspaceId, t.unitId],
      foreignColumns: [lodgingUnits.workspaceId, lodgingUnits.id],
    }).onDelete('cascade'),
    unique('lodging_night_notes_unique')
      .on(t.workspaceId, t.propertyId, t.unitId, t.night)
      .nullsNotDistinct(),
    index('lodging_night_notes_range_idx').on(t.workspaceId, t.propertyId, t.night),
    ...tenantPolicies('lodging_night_notes'),
  ],
);

/**
 * The hold the bot summarised and the customer has not confirmed yet (migration 0043, T-161):
 * one per conversation, 30 minutes. `id` is new on every prepare; the booking's
 * `client_request_id` is derived from it.
 */
export const lodgingBotHoldDrafts = pgTable(
  'lodging_bot_hold_drafts',
  {
    workspaceId: workspaceRef(),
    conversationId: uuid('conversation_id').notNull(),
    id: uuid('id').notNull(),
    botId: uuid('bot_id').notNull(),
    botName: text('bot_name').notNull().default(''),
    channel: text('channel').notNull(),
    contactId: uuid('contact_id'),
    propertyId: uuid('property_id').notNull(),
    whole: boolean('whole').notNull(),
    unitIds: uuid('unit_ids')
      .array()
      .notNull()
      .default(sql`'{}'`),
    checkIn: night('check_in').notNull(),
    checkOut: night('check_out').notNull(),
    adults: integer('adults').notNull(),
    childAges: integer('child_ages')
      .array()
      .notNull()
      .default(sql`'{}'`),
    guestName: text('guest_name').notNull(),
    guestPhone: text('guest_phone').notNull(),
    note: text('note').notNull().default(''),
    quoteHash: text('quote_hash').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.conversationId] }),
    foreignKey({
      name: 'lodging_bot_hold_drafts_property_fk',
      columns: [t.workspaceId, t.propertyId],
      foreignColumns: [lodgingProperties.workspaceId, lodgingProperties.id],
    }).onDelete('cascade'),
    index('lodging_bot_hold_drafts_expiry_idx').on(t.workspaceId, t.expiresAt),
    ...tenantPolicies('lodging_bot_hold_drafts'),
  ],
);
