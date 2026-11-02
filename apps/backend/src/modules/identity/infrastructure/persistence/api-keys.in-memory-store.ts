import type { WorkspaceId } from '@agent-sales/shared';

import type {
  ApiKeyRecord,
  ApiKeyStore,
  IdempotencyClaim,
  IdempotencyStore,
} from '../../application/ports/api-keys.js';

/** In-memory API keys (no database configured: tests, local runs). */
export class InMemoryApiKeyStore implements ApiKeyStore {
  readonly #rows = new Map<string, ApiKeyRecord>();

  insert(r: ApiKeyRecord): Promise<void> {
    this.#rows.set(r.id, { ...r });
    return Promise.resolve();
  }

  list(ws: WorkspaceId): Promise<ApiKeyRecord[]> {
    return Promise.resolve(
      [...this.#rows.values()]
        .filter((r) => r.workspaceId === ws)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((r) => ({ ...r })),
    );
  }

  revoke(ws: WorkspaceId, id: string, at: Date): Promise<ApiKeyRecord | null> {
    const r = this.#rows.get(id);
    if (!r || r.workspaceId !== ws) return Promise.resolve(null);
    r.revokedAt ??= at;
    return Promise.resolve({ ...r });
  }

  findByKeyId(keyId: string): Promise<ApiKeyRecord | null> {
    const r = [...this.#rows.values()].find((x) => x.keyId === keyId);
    return Promise.resolve(r ? { ...r } : null);
  }

  touch(id: string, at: Date): Promise<void> {
    const r = this.#rows.get(id);
    if (r) r.lastUsedAt = at;
    return Promise.resolve();
  }
}

interface Entry {
  requestHash: string;
  status: number | null;
  body: unknown;
  createdAt: Date;
}

/** In-memory `Idempotency-Key` records. */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly #rows = new Map<string, Entry>();

  claim(input: Parameters<IdempotencyStore['claim']>[0]): Promise<IdempotencyClaim> {
    const id = `${input.apiKeyId}\u0000${input.key}`;
    const e = this.#rows.get(id);
    if (!e || e.createdAt < input.expiredBefore) {
      this.#rows.set(id, {
        requestHash: input.requestHash,
        status: null,
        body: null,
        createdAt: new Date(),
      });
      return Promise.resolve({ kind: 'claimed' });
    }
    if (e.requestHash !== input.requestHash) return Promise.resolve({ kind: 'mismatch' });
    if (e.status === null) return Promise.resolve({ kind: 'in_flight' });
    return Promise.resolve({ kind: 'replay', status: e.status, body: e.body });
  }

  complete(apiKeyId: string, key: string, status: number, body: unknown): Promise<void> {
    const e = this.#rows.get(`${apiKeyId}\u0000${key}`);
    if (e) Object.assign(e, { status, body: body ?? null });
    return Promise.resolve();
  }

  release(apiKeyId: string, key: string): Promise<void> {
    this.#rows.delete(`${apiKeyId}\u0000${key}`);
    return Promise.resolve();
  }
}
