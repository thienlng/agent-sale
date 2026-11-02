import type { AssistantProposalDto } from '@agent-sales/contracts';

/** The route whose done proposal opens the created action, so the owner types its key (T-174). */
export const ACTION_DRAFT_ROUTE = 'POST /bots/{botId}/actions';

const ACTIONS_PATH = /^\/bots\/([0-9a-f-]{36})\/actions$/i;

/** Where a done proposal's result opens; the bot id comes from the proposal's concrete path. */
export interface ProposalLink {
  botId: string;
  actionId: string;
}

/**
 * The page that finishes what a proposal created: for a done `POST /bots/{botId}/actions` with
 * its `resultId`, the new action (to type the key, test and turn it on). Null for anything else.
 */
export function openLinkFor(
  proposal: Pick<AssistantProposalDto, 'routeKey' | 'path' | 'status' | 'resultId'>,
): ProposalLink | null {
  if (proposal.routeKey !== ACTION_DRAFT_ROUTE) return null;
  if (proposal.status !== 'done' || !proposal.resultId) return null;
  const botId = ACTIONS_PATH.exec(proposal.path)?.[1];
  return botId ? { botId, actionId: proposal.resultId } : null;
}
