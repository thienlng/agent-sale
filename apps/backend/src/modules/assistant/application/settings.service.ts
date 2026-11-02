import type { AssistantSettingsDto, UpdateAssistantSettingsRequest } from '@agent-sales/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { AssistantSettingsInvalidError } from '../domain/assistant.errors.js';
import {
  ASSISTANT_REPOSITORY,
  type AssistantRepository,
  type AssistantSettingsRecord,
  type OwnerKey,
} from '../domain/ports/assistant.repository.js';
import { isLockedToolset, normalizeDisabled, TOOLSETS } from './toolsets.js';

/** The window of the settings page's toolset use counts. */
export const TOOLSET_USE_DAYS = 30;
const DAY_MS = 24 * 60 * 60_000;

/**
 * The owner's assistant settings (spec §6, §11): the background review on or off, and the
 * toolsets the chat turn leaves out. `core` and `ui` are always on.
 */
@Injectable()
export class AssistantSettingsService {
  constructor(@Inject(ASSISTANT_REPOSITORY) private readonly repo: AssistantRepository) {}

  async get(s: OwnerKey, now = new Date()): Promise<AssistantSettingsDto> {
    return this.#dto(s, await this.repo.getSettings(s), now);
  }

  /** 400 when a locked toolset (`core`, `ui`) is in `disabledToolsets`. */
  async update(
    s: OwnerKey,
    patch: UpdateAssistantSettingsRequest,
    now = new Date(),
  ): Promise<AssistantSettingsDto> {
    const locked = (patch.disabledToolsets ?? []).filter(isLockedToolset);
    if (locked.length > 0) throw new AssistantSettingsInvalidError(locked);
    const saved = await this.repo.saveSettings(s, {
      ...(patch.reviewEnabled !== undefined ? { reviewEnabled: patch.reviewEnabled } : {}),
      ...(patch.disabledToolsets !== undefined
        ? { disabledToolsets: normalizeDisabled(patch.disabledToolsets) }
        : {}),
    });
    return this.#dto(s, saved, now);
  }

  async #dto(
    s: OwnerKey,
    settings: AssistantSettingsRecord,
    now: Date,
  ): Promise<AssistantSettingsDto> {
    const uses = await this.repo.countToolUses(
      s,
      new Date(now.getTime() - TOOLSET_USE_DAYS * DAY_MS),
    );
    return {
      reviewEnabled: settings.reviewEnabled,
      disabledToolsets: normalizeDisabled(settings.disabledToolsets),
      toolsets: TOOLSETS.map((t) => ({
        id: t.id,
        labelKey: t.labelKey,
        toolCount: t.tools.length + (t.deferred?.length ?? 0),
        uses30d: [...t.tools, ...(t.deferred ?? [])].reduce((n, tool) => n + (uses[tool] ?? 0), 0),
        locked: isLockedToolset(t.id),
      })),
    };
  }
}
