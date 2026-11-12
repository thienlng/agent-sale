import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** GLOBAL table (no workspace_id, no RLS). Only app_system may access it (migration 0001). */
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  phone: text('phone'),
  phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
  passwordHash: text('password_hash'),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Asia/Ho_Chi_Minh'),
  locale: text('locale').notNull().default('vi'),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** GLOBAL: refresh-token sessions with rotation families (ADR-007). app_system only. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_family_idx').on(t.familyId)],
);

/** GLOBAL: TOTP second factor, one row per user (migration 0018). app_system only. */
export const userMfa = pgTable('user_mfa', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  secretSealed: text('secret_sealed').notNull(),
  /** Null while setup is pending (secret issued, first code not confirmed yet). */
  enabledAt: timestamp('enabled_at', { withTimezone: true }),
  /** Highest accepted 30 s step: a code can never be replayed. */
  lastUsedStep: bigint('last_used_step', { mode: 'number' }).notNull().default(0),
  recoveryHashes: text('recovery_hashes')
    .array()
    .notNull()
    .default(sql`'{}'`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** GLOBAL: emailed one-time codes, one live code per address and purpose (migration 0056). app_system only. */
export const emailCodes = pgTable(
  'email_codes',
  {
    email: text('email').notNull(),
    purpose: text('purpose').$type<'signup' | 'reset_password'>().notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.email, t.purpose] })],
);

/**
 * GLOBAL: accounts at an external identity provider linked to a user (migration 0072). The
 * provider's subject id is the key, not the email. app_system only.
 */
export const userIdentities = pgTable(
  'user_identities',
  {
    provider: text('provider').$type<'google'>().notNull(),
    subject: text('subject').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.subject] }),
    index('user_identities_user_idx').on(t.userId),
  ],
);

/**
 * GLOBAL: shared fixed-window auth counters (logins per account, code emails and checks per
 * address; migration 0076). The key is a sha256. app_system only.
 */
export const authCounters = pgTable(
  'auth_counters',
  {
    keyHash: text('key_hash').primaryKey(),
    count: integer('count').notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
  },
  (t) => [index('auth_counters_window_end_idx').on(t.windowEnd)],
);

/**
 * GLOBAL: who got the signup trial of a canonical email (sha256; migration 0076). The user id goes
 * null when the user is deleted, and the claim stays. app_system only.
 */
export const trialClaims = pgTable('trial_claims', {
  emailHash: text('email_hash').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
});
