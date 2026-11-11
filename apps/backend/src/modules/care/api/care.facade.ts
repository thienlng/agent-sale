import type { CareMessageDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/**
 * PUBLIC CONTRACT of the care module (spec 2026-11-11 care agent, ADR-031). Nothing depends on
 * it today; the inbox may read a conversation's care messages through it later.
 */
export interface CareFacade {
  /** The care messages of a conversation, newest first (at most 50). */
  messagesOf(ws: WorkspaceId, conversationId: string): Promise<CareMessageDto[]>;
}

export const CARE_FACADE = Symbol('CARE_FACADE');
