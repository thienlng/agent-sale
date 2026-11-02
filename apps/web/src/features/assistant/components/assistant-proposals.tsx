import type { AssistantProposalDto } from '@agent-sales/contracts';
import { Check, ChevronDown, Clock, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ApiClientError } from '@/lib/api-client';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

import { useDecideAssistantProposal } from '../api/assistant';

/** Preview text for the card: the server's preview as indented JSON, capped for the panel. */
function previewText(preview: unknown): string {
  if (preview === undefined || preview === null) return '';
  const text = typeof preview === 'string' ? preview : JSON.stringify(preview, null, 2);
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}

function useBusinessName(businessId: string): string | null {
  const session = useSession();
  return session?.memberships.find((m) => m.workspaceId === businessId)?.workspaceName ?? null;
}

/** A decided (or running) proposal: one quiet status line. */
function ProposalStatus({ proposal }: { proposal: AssistantProposalDto }) {
  const { t } = useTranslation('assistant');
  const { status } = proposal;
  const Icon =
    status === 'done' ? Check : status === 'executing' ? Loader2 : status === 'expired' ? Clock : X;
  return (
    <li
      className={cn(
        'flex max-w-[85%] items-center gap-1.5 self-start text-xs',
        status === 'failed' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      <Icon
        className={cn('size-3.5 shrink-0', status === 'executing' && 'animate-spin')}
        aria-hidden
      />
      <span className="truncate font-medium">{proposal.summary}</span>
      <span aria-hidden>·</span>
      <span className="shrink-0">
        {t(`proposals.status.${status}`, { code: proposal.errorCode ?? '' })}
      </span>
    </li>
  );
}

/** A pending proposal: summary, business, a collapsible preview and Áp dụng / Bỏ. */
function PendingProposal({ proposal }: { proposal: AssistantProposalDto }) {
  const { t } = useTranslation('assistant');
  const business = useBusinessName(proposal.businessId);
  const [showPreview, setShowPreview] = useState(false);
  const decide = useDecideAssistantProposal(proposal.threadId);
  const preview = previewText(proposal.preview);
  const previewId = `proposal-preview-${proposal.id}`;

  function run(decision: 'approve' | 'reject'): void {
    decide.mutate(
      { proposalId: proposal.id, decision },
      {
        onError: (error) => {
          // 409: decided elsewhere or expired; the refetch shows its real status.
          if (!(error instanceof ApiClientError) || error.status !== 409)
            toast.error(t('proposals.decideError'));
          else if (error.details?.['reason'] === 'proposal_expired')
            toast.error(t('proposals.expired'));
          else toast.error(t('proposals.notPending'));
        },
      },
    );
  }

  const busy = decide.isPending;
  const applying = busy && decide.variables?.decision === 'approve';
  return (
    <li
      className="flex w-[92%] min-w-0 flex-col gap-2 self-start rounded-xl border border-primary/30 bg-primary-soft/40 px-3 py-2.5"
      aria-label={t('proposals.label')}
    >
      <div className="min-w-0">
        <p className="text-xs font-medium tracking-wide text-primary uppercase">
          {t('proposals.label')}
        </p>
        <p className="mt-0.5 font-medium break-words">{proposal.summary}</p>
        {business ? (
          <p className="text-xs text-muted-foreground">
            {t('proposals.business', { name: business })}
          </p>
        ) : null}
      </div>
      {preview ? (
        <>
          <button
            type="button"
            aria-expanded={showPreview}
            aria-controls={previewId}
            onClick={() => setShowPreview((v) => !v)}
            className="inline-flex w-fit items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {showPreview ? t('proposals.hidePreview') : t('proposals.showPreview')}
            <ChevronDown
              className={cn('size-3 transition-transform', showPreview && 'rotate-180')}
              aria-hidden
            />
          </button>
          {showPreview ? (
            <pre
              id={previewId}
              className="max-h-48 overflow-auto rounded-md bg-background px-2 py-1.5 font-mono text-xs break-words whitespace-pre-wrap"
            >
              {preview}
            </pre>
          ) : null}
        </>
      ) : null}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => run('approve')}>
          {applying ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {applying ? t('proposals.applying') : t('proposals.apply')}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run('reject')}>
          {t('proposals.reject')}
        </Button>
      </div>
    </li>
  );
}

/** One proposal in the conversation: a card while pending, a status line once decided. */
export function AssistantProposal({ proposal }: { proposal: AssistantProposalDto }) {
  return proposal.status === 'pending' ? (
    <PendingProposal proposal={proposal} />
  ) : (
    <ProposalStatus proposal={proposal} />
  );
}
