import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './identity.js';
import { tenantPolicies, workspaces } from './workspace.js';

// Tenant tables of the identity module (0055, ADR-022). Kept apart from identity.ts, which holds
// the global tables that workspace.ts itself depends on.

const ts = (name: string) => timestamp(name, { withTimezone: true });
const workspaceRef = () =>
  uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id);

/** Workspace API keys `rpz_live_<keyId>_<secret>`: only the SHA-256 of the secret is stored. */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    /** The member the key acts for (`scopes ∩ role`); the key stops working when they leave. */
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    keyId: text('key_id').notNull().unique(),
    secretHash: text('secret_hash').notNull(),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'`),
    expiresAt: ts('expires_at'),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('api_keys_workspace_idx').on(t.workspaceId, t.createdAt.desc()),
    ...tenantPolicies('api_keys'),
  ],
);

/** First response of a write sent with `Idempotency-Key`, replayed for 24 h per API key. */
export const apiIdempotencyKeys = pgTable(
  'api_idempotency_keys',
  {
    workspaceId: workspaceRef(),
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull(),
    /** SHA-256 of method + path + body. */
    requestHash: text('request_hash').notNull(),
    /** Null while the first request is still running. */
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.apiKeyId, t.idempotencyKey] }),
    index('api_idempotency_keys_created_idx').on(t.createdAt),
    ...tenantPolicies('api_idempotency_keys'),
  ],
);
