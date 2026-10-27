import type { WebsiteVisitorDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** PUBLIC CONTRACT of the webchat module. */
export interface WebchatFacade {
  /** Visitor details of a website conversation for the inbox side panel; throws NOT_FOUND otherwise. */
  getVisitor(ws: WorkspaceId, conversationId: string): Promise<WebsiteVisitorDto>;
}

export const WEBCHAT_FACADE = Symbol('WEBCHAT_FACADE');
