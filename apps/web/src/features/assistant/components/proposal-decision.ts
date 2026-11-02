import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ApiClientError } from '@/lib/api-client';

import { useDecideAssistantProposal, useProposalDecisionInFlight } from '../api/assistant';

/**
 * Approve / reject one proposal from any card: the decision runs once (the busy state is keyed by
 * the proposal id, so it survives the card unmounting), and a 409 says why in a toast.
 */
export function useProposalDecision(proposal: {
  id: string;
  threadId: string;
  businessId: string;
}) {
  const { t } = useTranslation('assistant');
  const decide = useDecideAssistantProposal(proposal, (error) => {
    // 409: decided elsewhere or expired; the refetch shows its real status.
    if (!(error instanceof ApiClientError) || error.status !== 409)
      toast.error(t('proposals.decideError'));
    else if (error.details?.['reason'] === 'proposal_expired') toast.error(t('proposals.expired'));
    else toast.error(t('proposals.notPending'));
  });
  const inFlight = useProposalDecisionInFlight(proposal.id);
  return {
    inFlight,
    run(decision: 'approve' | 'reject'): void {
      if (inFlight) return;
      decide.mutate(decision);
    },
  };
}
