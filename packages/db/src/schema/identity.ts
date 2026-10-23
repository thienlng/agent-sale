import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** GLOBAL table (no workspace_id, no RLS) — docs/05 §9 5b. */
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
