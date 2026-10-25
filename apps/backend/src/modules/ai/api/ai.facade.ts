import type { PlaygroundRequest, PlaygroundResponse } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** PUBLIC CONTRACT of the ai module. */
export interface AiFacade {
  /** A grounded channel reply. The caller must recheck human control before delivery. */
  reply(
    workspaceId: WorkspaceId,
    botId: string,
    input: PlaygroundRequest,
    /** `eventId`: the channel event being answered, the base of action idempotency keys. */
    context: { conversationId: string; isTest: boolean; eventId?: string },
  ): Promise<PlaygroundResponse>;
  /** One grounded test reply for a bot; metered in ai_runs with is_test = true. */
  playground(
    workspaceId: WorkspaceId,
    botId: string,
    input: PlaygroundRequest,
  ): Promise<PlaygroundResponse>;
}

export const AI_FACADE = Symbol('AI_FACADE');
