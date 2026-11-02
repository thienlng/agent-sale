import type { UserId, WorkspaceId } from '@agent-sales/shared';

/** A workspace API key as stored (ADR-022 §2): only the SHA-256 of the secret is kept. */
export interface ApiKeyRecord {
  id: string;
  workspaceId: WorkspaceId;
  /** The member the key acts for. */
  createdBy: UserId;
  name: string;
  /** The 12-char public part of `rpz_live_<keyId>_<secret>`. */
  keyId: string;
  /** Hex SHA-256 of the secret part. */
  secretHash: string;
  scopes: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** API keys (identity owns them like sessions: they are credentials). */
export interface ApiKeyStore {
  insert(record: ApiKeyRecord): Promise<void>;
  /** Keys of a workspace, newest first. */
  list(ws: WorkspaceId): Promise<ApiKeyRecord[]>;
  /** Sets `revoked_at` (once) and returns the key; null when it is not in the workspace. */
  revoke(ws: WorkspaceId, id: string, at: Date): Promise<ApiKeyRecord | null>;
  /** Cross-tenant lookup by the public key id (authentication). */
  findByKeyId(keyId: string): Promise<ApiKeyRecord | null>;
  touch(id: string, at: Date): Promise<void>;
}
export const API_KEY_STORE = Symbol('API_KEY_STORE');

/** What a write with an `Idempotency-Key` header finds (ADR-022 §4). */
export type IdempotencyClaim =
  | { kind: 'claimed' }
  | { kind: 'replay'; status: number; body: unknown }
  | { kind: 'in_flight' }
  | { kind: 'mismatch' };

/** First response of a write per (API key, Idempotency-Key), replayed for 24 h. */
export interface IdempotencyStore {
  /** Claims the key for this request; rows older than `expiredBefore` are replaced. */
  claim(input: {
    workspaceId: WorkspaceId;
    apiKeyId: string;
    key: string;
    requestHash: string;
    expiredBefore: Date;
  }): Promise<IdempotencyClaim>;
  /** Stores the response of a claimed key. */
  complete(apiKeyId: string, key: string, status: number, body: unknown): Promise<void>;
  /** Forgets a claimed key whose request failed, so the client may retry. */
  release(apiKeyId: string, key: string): Promise<void>;
}
export const IDEMPOTENCY_STORE = Symbol('IDEMPOTENCY_STORE');

/** Fixed-window request counter per API key. */
export interface ApiRateLimiter {
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}
export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Milliseconds until the window resets. */
  resetMs: number;
}
export const API_RATE_LIMITER = Symbol('API_RATE_LIMITER');

/** The workspace's plan rights for the public API (billing entitlements). */
export interface ApiPlanGate {
  /** `perMinute` null = unlimited. */
  of(ws: WorkspaceId): Promise<{ enabled: boolean; perMinute: number | null }>;
}
export const API_PLAN_GATE = Symbol('API_PLAN_GATE');
