import {
  API_KEY_SCOPES,
  type ApiKeyDto,
  type Capability,
  type CreateApiKeyRequest,
  type CreatedApiKey,
  ROLE_CAPABILITIES,
  type WorkspaceRole,
} from '@agent-sales/contracts';
import { isUuid, newId, type UserId, userId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import type { IdentityApiKeysFacade } from '../api/identity.facade.js';
import { USER_REPOSITORY, type UserRepository } from '../domain/ports/user.repository.js';
import {
  ApiKeyNotFoundError,
  InvalidApiKeyInputError,
  PublicApiLockedError,
} from '../domain/identity.errors.js';
import { generateApiKey, keyPrefix, parseApiKey, secretMatches } from './api-key-secrets.js';
import { SecurityEventService } from './security-events.js';
import {
  API_KEY_STORE,
  API_PLAN_GATE,
  type ApiKeyRecord,
  type ApiKeyStore,
  type ApiPlanGate,
} from './ports/api-keys.js';

/** A verified API key, ready for the guard to build the request's auth state. */
export interface ApiKeyPrincipal {
  id: string;
  name: string;
  workspaceId: WorkspaceId;
  userId: UserId;
  /** `scopes ∩ the creator's role` (ADR-022 §3). */
  capabilities: Capability[];
  /** The creator's member role (rules such as "a CSKH creator owns as CSKH" depend on it). */
  creatorRole: string;
  /** Requests per minute; null = unlimited. */
  perMinute: number | null;
}

/** Why a key was refused; every reason answers the caller the same 401. */
export type ApiKeyRejection = 'malformed' | 'unknown' | 'revoked' | 'expired' | 'not_member';

const TOUCH_EVERY_MS = 60_000;
const SCOPES = new Set<string>(API_KEY_SCOPES);

const status = (r: ApiKeyRecord, now: Date): ApiKeyDto['status'] =>
  r.revokedAt ? 'revoked' : r.expiresAt && r.expiresAt <= now ? 'expired' : 'active';

/**
 * Workspace API keys (ADR-022 §2–3): creation (the full key is returned once), listing,
 * revocation, and the verification the AuthGuard runs on every `Bearer rpz_live_…` request.
 */
@Injectable()
export class ApiKeyService implements IdentityApiKeysFacade {
  /** keyId → last `last_used_at` write (ms): one write per key per minute per process. */
  readonly #touched = new Map<string, number>();

  constructor(
    @Inject(API_KEY_STORE) private readonly store: ApiKeyStore,
    @Inject(API_PLAN_GATE) private readonly plan: ApiPlanGate,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(SecurityEventService) private readonly events: SecurityEventService,
  ) {}

  async list(ws: WorkspaceId): Promise<ApiKeyDto[]> {
    return this.#toDtos(await this.store.list(ws));
  }

  async create(
    ws: WorkspaceId,
    actor: UserId,
    input: CreateApiKeyRequest,
    now = new Date(),
  ): Promise<CreatedApiKey> {
    if (!(await this.plan.of(ws)).enabled) throw new PublicApiLockedError();
    const scopes = [...new Set(input.scopes)];
    if (scopes.some((s) => !SCOPES.has(s)))
      throw new InvalidApiKeyInputError('Unknown scope', { scopes });
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt <= now)
      throw new InvalidApiKeyInputError('The expiry must be in the future');
    const { key, keyId, secretHash } = generateApiKey();
    const record: ApiKeyRecord = {
      id: newId(),
      workspaceId: ws,
      createdBy: actor,
      name: input.name.trim(),
      keyId,
      secretHash,
      scopes,
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: now,
    };
    await this.store.insert(record);
    await this.events.record(actor, 'api_key.created', { workspaceId: ws, apiKeyId: record.id });
    const [dto] = await this.#toDtos([record], now);
    return { apiKey: dto as ApiKeyDto, key };
  }

  async revoke(ws: WorkspaceId, id: string, actor?: UserId, now = new Date()): Promise<ApiKeyDto> {
    const record = isUuid(id) ? await this.store.revoke(ws, id, now) : null;
    if (!record) throw new ApiKeyNotFoundError();
    if (actor)
      await this.events.record(actor, 'api_key.revoked', { workspaceId: ws, apiKeyId: id });
    const [dto] = await this.#toDtos([record], now);
    return dto as ApiKeyDto;
  }

  /**
   * Verifies a `rpz_live_…` token: known key, matching secret (constant time), not revoked or
   * expired, creator still a member. The plan gate is checked by the caller (other error code).
   */
  async verify(
    token: string,
    now = new Date(),
  ): Promise<{ ok: true; principal: ApiKeyPrincipal } | { ok: false; reason: ApiKeyRejection }> {
    const parsed = parseApiKey(token);
    if (!parsed) return { ok: false, reason: 'malformed' };
    const r = await this.store.findByKeyId(parsed.keyId);
    if (!r || !secretMatches(parsed.secret, r.secretHash)) return { ok: false, reason: 'unknown' };
    if (r.revokedAt) return { ok: false, reason: 'revoked' };
    if (r.expiresAt && r.expiresAt <= now) return { ok: false, reason: 'expired' };
    const membership = await this.workspaces.findMembership(r.workspaceId, r.createdBy);
    if (!membership) return { ok: false, reason: 'not_member' };
    const role = ROLE_CAPABILITIES[membership.role as WorkspaceRole] ?? [];
    const capabilities = role.filter((c) => r.scopes.includes(c));
    const { perMinute } = await this.plan.of(r.workspaceId);
    this.#touch(r, now);
    return {
      ok: true,
      principal: {
        id: r.id,
        name: r.name,
        workspaceId: r.workspaceId,
        userId: r.createdBy,
        capabilities,
        creatorRole: membership.role,
        perMinute,
      },
    };
  }

  /** Is the public API in the workspace's plan? */
  /**
   * Password reset: the keys the user created act for them in every workspace, and whoever took
   * over the account may have made some, so all of them stop working (docs/09 §2).
   */
  async revokeAllCreatedBy(userId: UserId, now = new Date()): Promise<number> {
    const revoked = await this.store.revokeAllCreatedBy(userId, now);
    for (const r of revoked)
      await this.events.record(userId, 'api_key.revoked', {
        workspaceId: r.workspaceId,
        apiKeyId: r.id,
        reason: 'password_reset',
      });
    return revoked.length;
  }

  async enabled(ws: WorkspaceId): Promise<boolean> {
    return (await this.plan.of(ws)).enabled;
  }

  #touch(r: ApiKeyRecord, now: Date): void {
    const last = this.#touched.get(r.id) ?? r.lastUsedAt?.getTime() ?? 0;
    if (now.getTime() - last < TOUCH_EVERY_MS) return;
    this.#touched.set(r.id, now.getTime());
    // Best effort: a failed write must not fail the request.
    void this.store.touch(r.id, now).catch(() => undefined);
  }

  async #toDtos(records: ApiKeyRecord[], now = new Date()): Promise<ApiKeyDto[]> {
    const ids = [...new Set(records.map((r) => r.createdBy))];
    const users = await this.users.findByIds(ids.map((id) => userId(id)));
    const names = new Map(users.map((u) => [u.snapshot().id as string, u.snapshot().name]));
    return records.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: keyPrefix(r.keyId),
      scopes: r.scopes.filter((s): s is ApiKeyDto['scopes'][number] => SCOPES.has(s)),
      status: status(r, now),
      createdBy: { userId: r.createdBy, name: names.get(r.createdBy) ?? '' },
      expiresAt: r.expiresAt?.toISOString() ?? null,
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      revokedAt: r.revokedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
