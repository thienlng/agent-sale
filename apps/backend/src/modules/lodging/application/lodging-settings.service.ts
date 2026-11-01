import type { BotPropertiesDto, LodgingSettings } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { BOT_FACADE, type BotFacade } from '../../bot/api/index.js';
import { LodgingError } from '../domain/lodging.errors.js';
import { LodgingAccess } from './lodging-access.js';
import { LODGING_STORE, type LodgingStore } from './ports/lodging-store.js';

/** Business-wide lodging settings and the properties each bot sells (spec §3.6–3.7). */
@Injectable()
export class LodgingSettingsService {
  constructor(
    @Inject(LODGING_STORE) private readonly store: LodgingStore,
    @Inject(LodgingAccess) private readonly access: LodgingAccess,
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
  ) {}

  async get(ws: WorkspaceId): Promise<LodgingSettings> {
    await this.access.assertHotel(ws);
    return this.store.run(ws, (tx) => tx.settings());
  }

  async update(ws: WorkspaceId, input: LodgingSettings, actorId: string): Promise<LodgingSettings> {
    await this.access.assertHotel(ws);
    return this.store.run(ws, async (tx) => {
      await tx.updateSettings({ holdMinutes: input.holdMinutes });
      await tx.audit(actorId, 'lodging_settings', ws, 'lodging.settings.updated', {
        holdMinutes: input.holdMinutes,
      });
      return tx.settings();
    });
  }

  /** The bot's stored selection, or every active property when it has none. */
  async botProperties(ws: WorkspaceId, botId: string): Promise<BotPropertiesDto> {
    await this.access.assertHotel(ws);
    await this.bots.getBot(ws, botId);
    return this.store.run(ws, async (tx) => ({
      propertyIds:
        (await tx.botPropertyIds(botId)) ??
        (await tx.properties({ activeOnly: true })).map((p) => p.id),
    }));
  }

  /** Replaces the selection; an empty list means "every active property" again. */
  async setBotProperties(
    ws: WorkspaceId,
    botId: string,
    input: BotPropertiesDto,
    actorId: string,
  ): Promise<BotPropertiesDto> {
    await this.access.assertHotel(ws);
    await this.bots.getBot(ws, botId);
    const ids = [...new Set(input.propertyIds)];
    return this.store.run(ws, async (tx) => {
      const found = await tx.properties({ ids });
      if (found.length !== ids.length) {
        const known = new Set(found.map((p) => p.id));
        throw new LodgingError('VALIDATION_FAILED', 'A property does not exist in this business', {
          propertyIds: ids.filter((id) => !known.has(id)),
        });
      }
      await tx.setBotProperties(botId, ids);
      await tx.audit(actorId, 'bot', botId, 'lodging.bot_properties.updated', {
        propertyIds: ids,
      });
      return {
        propertyIds:
          (await tx.botPropertyIds(botId)) ??
          (await tx.properties({ activeOnly: true })).map((p) => p.id),
      };
    });
  }
}
