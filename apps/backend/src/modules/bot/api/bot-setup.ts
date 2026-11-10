import type {
  BotDto,
  CreateBotRequest,
  CreateFaqRequest,
  FaqDto,
  UpdateBotRequest,
  UpdateFaqRequest,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/**
 * Bot setup for operator tooling (CLIs such as `rapiz-site-bot`): the same use cases as the HTTP
 * routes, so pack seeding, validation and the training history apply. `actor` names who changed
 * the bot in the training history.
 */
export interface BotSetupFacade {
  list(ws: WorkspaceId): Promise<BotDto[]>;
  create(ws: WorkspaceId, input: CreateBotRequest): Promise<BotDto>;
  update(ws: WorkspaceId, botId: string, change: UpdateBotRequest, actor?: string): Promise<BotDto>;
  listFaqs(ws: WorkspaceId, botId: string): Promise<FaqDto[]>;
  createFaq(
    ws: WorkspaceId,
    botId: string,
    input: CreateFaqRequest,
    actor?: string,
  ): Promise<FaqDto>;
  updateFaq(
    ws: WorkspaceId,
    botId: string,
    faqId: string,
    change: UpdateFaqRequest,
    actor?: string,
  ): Promise<FaqDto>;
}

export const BOT_SETUP = Symbol('BOT_SETUP');
