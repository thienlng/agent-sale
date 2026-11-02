import type { AssistantProposalDto } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ApiClientError } from '@/lib/api-client';

import {
  type ProposalDecision,
  useDecideAssistantProposal,
  useProposalDecisionInFlight,
} from '../api/assistant';

/**
 * Approve/reject for one proposal card: `run` ignores a second click while a decision is on its
 * way (from any card instance), and errors become toasts (409: decided elsewhere or expired).
 */
export function useProposalDecider(proposal: AssistantProposalDto) {
  const { t } = useTranslation('assistant');
  const decide = useDecideAssistantProposal(proposal, (error) => {
    // 409: decided elsewhere or expired; the refetch shows its real status.
    if (!(error instanceof ApiClientError) || error.status !== 409)
      toast.error(t('proposals.decideError'));
    else if (error.details?.['reason'] === 'proposal_expired') toast.error(t('proposals.expired'));
    else toast.error(t('proposals.notPending'));
  });
  // Keyed by the proposal id, so a card mounted again (another panel view and back) stays busy.
  const inFlight = useProposalDecisionInFlight(proposal.id);
  return {
    inFlight,
    busy: inFlight !== null,
    applying: inFlight === 'approve',
    run(decision: ProposalDecision): void {
      if (inFlight) return;
      decide.mutate(decision);
    },
  };
}
