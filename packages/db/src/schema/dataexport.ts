import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenantPolicies, workspaces } from './workspace.js';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Whole-workspace data exports (0070, SET-10). The worker claims `queued` rows with a lease,
 * writes the ZIP to the private exports bucket (`object_key`) and keeps it 7 days. The one-time
 * download link is stored only as the SHA-256 hex of its token.
 */
export const dataExports = pgTable(
  'data_exports',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    requestedByUserId: uuid('requested_by_user_id').notNull(),
    requestedByName: text('requested_by_name'),
    includeMedia: boolean('include_media').notNull().default(false),
    status: text('status')
      .notNull()
      .default('queued')
      .$type<'queued' | 'running' | 'ready' | 'failed' | 'expired'>(),
    attempts: integer('attempts').notNull().default(0),
    leaseUntil: ts('lease_until'),
    objectKey: text('object_key'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    errorCode: text('error_code'),
    downloadTokenHash: text('download_token_hash'),
    downloadTokenExpiresAt: ts('download_token_expires_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    expiresAt: ts('expires_at'),
  },
  (t) => [
    index('data_exports_workspace_idx').on(t.workspaceId, t.createdAt),
    ...tenantPolicies('data_exports'),
  ],
);
