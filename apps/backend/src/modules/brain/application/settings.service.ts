import { type BrainSettingsDto, UpdateBrainSettingsRequest } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { BRAIN_STORE, type BrainStore } from '../domain/ports/brain.store.js';
import { type BrainSettings, DEFAULT_BRAIN_SETTINGS } from '../domain/schedule.js';

/** Per-business Brain settings; a business that never saved them gets the defaults. */
@Injectable()
export class SettingsService {
  constructor(@Inject(BRAIN_STORE) private readonly store: BrainStore) {}

  async get(ws: WorkspaceId): Promise<BrainSettings> {
    return (await this.store.getSettings(ws)) ?? { ...DEFAULT_BRAIN_SETTINGS };
  }

  /** Replaces the settings (idle 30–120 minutes, briefing hour 0–23; validated again here). */
  async put(ws: WorkspaceId, input: BrainSettingsDto): Promise<BrainSettings> {
    const s = UpdateBrainSettingsRequest.parse(input);
    await this.store.putSettings(ws, s);
    return s;
  }
}
