import type { WorkspaceId } from '@agent-sales/shared';

import type { BotRepository } from '../../domain/ports/bot.repository.js';

export interface BotTxContext {
  bots: BotRepository;
}

export interface BotUnitOfWork {
  run<T>(workspaceId: WorkspaceId, fn: (ctx: BotTxContext) => Promise<T>): Promise<T>;
}

export const BOT_UOW = Symbol('BOT_UOW');
