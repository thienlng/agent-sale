import type { PlaygroundRequest, PlaygroundResponse } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** PUBLIC CONTRACT of the ai module. */
export interface AiFacade {
  /** One grounded test reply for a bot; metered in ai_runs with is_test = true. */
  playground(
    workspaceId: WorkspaceId,
    botId: string,
    input: PlaygroundRequest,
  ): Promise<PlaygroundResponse>;
}

export const AI_FACADE = Symbol('AI_FACADE');
