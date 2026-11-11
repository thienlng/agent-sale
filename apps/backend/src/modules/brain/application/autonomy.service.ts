import {
  type AutonomyAction,
  type AutonomyLevel,
  type AutonomySettingsResponse,
  UpdateAutonomySettingsRequest,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { AUTONOMY_REGISTRY, resolveLevel } from '../domain/autonomy.js';
import { AutonomyLevelNotAllowedError } from '../domain/brain.errors.js';
import { BRAIN_STORE, type BrainStore } from '../domain/ports/brain.store.js';

/** Per-business autonomy levels (`autonomy_settings`); a missing row is the action's default. */
@Injectable()
export class AutonomyService {
  constructor(@Inject(BRAIN_STORE) private readonly store: BrainStore) {}

  async list(ws: WorkspaceId): Promise<AutonomySettingsResponse> {
    const stored = new Map((await this.store.getAutonomy(ws)).map((r) => [r.action, r.level]));
    return {
      actions: (Object.keys(AUTONOMY_REGISTRY) as AutonomyAction[]).map((action) => ({
        action,
        level: resolveLevel(action, stored.get(action) ?? null),
        default: AUTONOMY_REGISTRY[action].default,
        levels: [...AUTONOMY_REGISTRY[action].levels],
      })),
    };
  }

  async levelFor(ws: WorkspaceId, action: AutonomyAction): Promise<AutonomyLevel> {
    const row = (await this.store.getAutonomy(ws)).find((r) => r.action === action);
    return resolveLevel(action, row?.level ?? null);
  }

  /** Sets the given actions (VALIDATION_FAILED for a level the action does not allow). */
  async put(
    ws: WorkspaceId,
    input: UpdateAutonomySettingsRequest,
    actorId: string | null,
    now = new Date(),
  ): Promise<AutonomySettingsResponse> {
    const body = UpdateAutonomySettingsRequest.parse(input);
    for (const a of body.actions) {
      if (!AUTONOMY_REGISTRY[a.action].levels.includes(a.level)) {
        throw new AutonomyLevelNotAllowedError(a.action, a.level);
      }
    }
    await this.store.putAutonomy(ws, body.actions, actorId, now);
    return this.list(ws);
  }
}
