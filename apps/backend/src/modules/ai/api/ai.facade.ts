import type { PlaygroundRequest, PlaygroundResponse } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import type { ReplyOptions, ReplyResult } from './reply-options.js';

/** PUBLIC CONTRACT of the ai module. */
export interface AiFacade {
  /** A grounded channel reply. The caller must recheck human control before delivery. */
  reply(
    workspaceId: WorkspaceId,
    botId: string,
    input: PlaygroundRequest,
    context: ReplyOptions,
  ): Promise<ReplyResult>;
  /** One grounded test reply for a bot; metered in ai_runs with is_test = true. */
  playground(
    workspaceId: WorkspaceId,
    botId: string,
    input: PlaygroundRequest,
  ): Promise<PlaygroundResponse>;
}

export const AI_FACADE = Symbol('AI_FACADE');
