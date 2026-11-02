import { and, type Database, desc, eq, isNull, lt, schema, withSystem } from '@agent-sales/db';
import { userId, workspaceId, type WorkspaceId } from '@agent-sales/shared';

import type {
  ApiKeyRecord,
  ApiKeyStore,
  IdempotencyClaim,
  IdempotencyStore,
} from '../../application/ports/api-keys.js';

const k = schema.apiKeys;
const i = schema.apiIdempotencyKeys;

const toRecord = (row: typeof k.$inferSelect): ApiKeyRecord => ({
  id: row.id,
  workspaceId: workspaceId(row.workspaceId),
  createdBy: userId(row.createdBy),
  name: row.name,
  keyId: row.keyId,
  secretHash: row.secretHash,
  scopes: row.scopes,
  expiresAt: row.expiresAt,
  lastUsedAt: row.lastUsedAt,
  revokedAt: row.revokedAt,
  createdAt: row.createdAt,
});

/**
 * API keys on the app_system connection: authentication looks a key up before any workspace is
 * known (like sessions). Every workspace read still filters by `workspace_id`.
 */
export class DrizzleApiKeyStore implements ApiKeyStore {
  constructor(private readonly systemDb: Database) {}

  insert(r: ApiKeyRecord): Promise<void> {
    return withSystem(this.systemDb, async (tx) => {
      await tx.insert(k).values({
        id: r.id,
        workspaceId: r.workspaceId,
        createdBy: r.createdBy,
        name: r.name,
        keyId: r.keyId,
        secretHash: r.secretHash,
        scopes: r.scopes,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
      });
    });
  }

  list(ws: WorkspaceId): Promise<ApiKeyRecord[]> {
    return withSystem(this.systemDb, async (tx) =>
      (
        await tx
          .select()
          .from(k)
          .where(eq(k.workspaceId, ws))
          .orderBy(desc(k.createdAt), desc(k.id))
          .limit(500)
      ).map(toRecord),
    );
  }

  revoke(ws: WorkspaceId, id: string, at: Date): Promise<ApiKeyRecord | null> {
    return withSystem(this.systemDb, async (tx) => {
      await tx
        .update(k)
        .set({ revokedAt: at })
        .where(and(eq(k.workspaceId, ws), eq(k.id, id), isNull(k.revokedAt)));
      const [row] = await tx
        .select()
        .from(k)
        .where(and(eq(k.workspaceId, ws), eq(k.id, id)));
      return row ? toRecord(row) : null;
    });
  }

  findByKeyId(keyId: string): Promise<ApiKeyRecord | null> {
    return withSystem(this.systemDb, async (tx) => {
      const [row] = await tx.select().from(k).where(eq(k.keyId, keyId)).limit(1);
      return row ? toRecord(row) : null;
    });
  }

  touch(id: string, at: Date): Promise<void> {
    return withSystem(this.systemDb, async (tx) => {
      await tx.update(k).set({ lastUsedAt: at }).where(eq(k.id, id));
    });
  }
}

/** `Idempotency-Key` records (ADR-022 §4) on the app_system connection, keyed by API key. */
export class DrizzleIdempotencyStore implements IdempotencyStore {
  constructor(private readonly systemDb: Database) {}

  claim(input: {
    workspaceId: WorkspaceId;
    apiKeyId: string;
    key: string;
    requestHash: string;
    expiredBefore: Date;
  }): Promise<IdempotencyClaim> {
    return withSystem(this.systemDb, async (tx) => {
      // Expired records of this key make room (bounded by the key's own rows).
      await tx
        .delete(i)
        .where(and(eq(i.apiKeyId, input.apiKeyId), lt(i.createdAt, input.expiredBefore)));
      const inserted = await tx
        .insert(i)
        .values({
          workspaceId: input.workspaceId,
          apiKeyId: input.apiKeyId,
          idempotencyKey: input.key,
          requestHash: input.requestHash,
        })
        .onConflictDoNothing()
        .returning({ key: i.idempotencyKey });
      if (inserted.length) return { kind: 'claimed' };
      const [row] = await tx
        .select()
        .from(i)
        .where(and(eq(i.apiKeyId, input.apiKeyId), eq(i.idempotencyKey, input.key)));
      if (!row) return { kind: 'in_flight' };
      if (row.requestHash !== input.requestHash) return { kind: 'mismatch' };
      if (row.responseStatus === null) return { kind: 'in_flight' };
      return { kind: 'replay', status: row.responseStatus, body: row.responseBody };
    });
  }

  complete(apiKeyId: string, key: string, status: number, body: unknown): Promise<void> {
    return withSystem(this.systemDb, async (tx) => {
      await tx
        .update(i)
        .set({ responseStatus: status, responseBody: body ?? null })
        .where(and(eq(i.apiKeyId, apiKeyId), eq(i.idempotencyKey, key)));
    });
  }

  release(apiKeyId: string, key: string): Promise<void> {
    return withSystem(this.systemDb, async (tx) => {
      await tx.delete(i).where(and(eq(i.apiKeyId, apiKeyId), eq(i.idempotencyKey, key)));
    });
  }
}
