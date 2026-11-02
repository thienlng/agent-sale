import type { AssistantProposalDto } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { Check, ChevronDown, Clock, KeyRound, Loader2, PowerOff, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

import { ImportProposalCard } from './import-proposal-card';
import { useProposalDecision } from './proposal-decision';
import { ACTION_DRAFT_ROUTE, openLinkFor } from '../utils/proposal-links';

/** Preview text for the card: a value as indented JSON, capped for the panel. */
function previewText(preview: unknown): string {
  if (preview === undefined || preview === null) return '';
  const text = typeof preview === 'string' ? preview : JSON.stringify(preview, null, 2);
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}

type ProposalVerb = 'post' | 'patch' | 'put' | 'delete';
const VERBS = new Set<string>(['post', 'patch', 'put', 'delete']);

/**
 * What will run, read from `routeKey` (`METHOD /path`), never from the model's summary: the
 * method (as a verb key), the route path, whether it removes or replaces data (DELETE, PUT) and
 * whether it changes an existing record (preview open by default).
 */
function proposalAction(routeKey: string): {
  verb: ProposalVerb | null;
  method: string;
  path: string;
  destructive: boolean;
  changesExisting: boolean;
} {
  const [rawMethod = '', ...rest] = routeKey.trim().split(/\s+/);
  const method = rawMethod.toLowerCase();
  const verb = VERBS.has(method) ? (method as ProposalVerb) : null;
  return {
    verb,
    method: rawMethod.toUpperCase(),
    path: rest.join(' '),
    destructive: verb === 'delete' || verb === 'put',
    changesExisting: verb === 'patch' || verb === 'put' || verb === 'delete',
  };
}

/** The preview split for the card: the record now (`before`) and what is sent (body/query). */
function previewParts(preview: unknown): { before: string; changes: string } {
  if (preview && typeof preview === 'object' && !Array.isArray(preview)) {
    const p = preview as Record<string, unknown>;
    if ('body' in p || 'query' in p || 'before' in p) {
      const sent =
        p['body'] !== undefined && p['body'] !== null
          ? p['body']
          : p['query'] !== undefined && p['query'] !== null
            ? p['query']
            : null;
      return { before: previewText(p['before']), changes: previewText(sent) };
    }
  }
  return { before: '', changes: previewText(preview) };
}

function useBusinessName(businessId: string): string | null {
  const session = useSession();
  return session?.memberships.find((m) => m.workspaceId === businessId)?.workspaceName ?? null;
}

/**
 * A decided (or running) proposal: one quiet status line; a created API action adds
 * "Mở để nhập khoá", since it was created disabled and without its key.
 */
function ProposalStatus({ proposal }: { proposal: AssistantProposalDto }) {
  const { t } = useTranslation('assistant');
  const { status } = proposal;
  const Icon =
    status === 'done' ? Check : status === 'executing' ? Loader2 : status === 'expired' ? Clock : X;
  const open = openLinkFor(proposal);
  return (
    <li className="flex max-w-[85%] flex-col items-start gap-1.5 self-start">
      <span
        className={cn(
          'flex max-w-full items-center gap-1.5 text-xs',
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
      </span>
      {open ? (
        <Button asChild size="sm" variant="outline">
          <Link
            to="/app/bots/$botId/actions/$actionId"
            params={{ botId: open.botId, actionId: open.actionId }}
          >
            <KeyRound aria-hidden />
            {t('proposals.openAction')}
          </Link>
        </Button>
      ) : null}
    </li>
  );
}

/** One labelled JSON block of the preview. */
function PreviewBlock({ label, text }: { label: string | null; text: string }) {
  return (
    <div className="min-w-0">
      {label ? <p className="mb-0.5 text-xs text-muted-foreground">{label}</p> : null}
      <pre className="max-h-48 overflow-auto rounded-md bg-background px-2 py-1.5 font-mono text-xs break-words whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  );
}

/**
 * A pending proposal: what will run (verb + route path, red for DELETE/PUT), the model's summary,
 * the business, the preview (open by default when it changes an existing record) and
 * Áp dụng / Bỏ.
 */
function PendingProposal({ proposal }: { proposal: AssistantProposalDto }) {
  const { t } = useTranslation('assistant');
  const business = useBusinessName(proposal.businessId);
  const action = proposalAction(proposal.routeKey);
  // A change to an existing record shows what it touches without a click.
  const [showPreview, setShowPreview] = useState(action.changesExisting);
  // Keyed by the proposal id, so a card mounted again (another panel view and back) stays busy.
  const { inFlight, run } = useProposalDecision(proposal);
  const { before, changes } = previewParts(proposal.preview);
  const hasPreview = Boolean(before || changes);
  const previewId = `proposal-preview-${proposal.id}`;

  const busy = inFlight !== null;
  const applying = inFlight === 'approve';
  return (
    <li
      className={cn(
        'flex w-[92%] min-w-0 flex-col gap-2 self-start rounded-xl border px-3 py-2.5',
        action.destructive
          ? 'border-destructive/50 bg-destructive/5'
          : 'border-primary/30 bg-primary-soft/40',
      )}
      aria-label={t('proposals.label')}
      data-destructive={action.destructive || undefined}
    >
      <div className="min-w-0">
        <p
          className={cn(
            'text-xs font-medium tracking-wide uppercase',
            action.destructive ? 'text-destructive' : 'text-primary',
          )}
        >
          {t('proposals.label')}
        </p>
        <p
          className={cn(
            'mt-1 flex min-w-0 items-baseline gap-1.5 text-xs',
            action.destructive && 'text-destructive',
          )}
          data-testid="proposal-action"
        >
          <span className="shrink-0 font-semibold">
            {action.verb ? t(`proposals.verbs.${action.verb}`) : action.method}
          </span>
          <code className="min-w-0 font-mono break-all">{action.path}</code>
        </p>
        <p className="mt-1 font-medium break-words">{proposal.summary}</p>
        {proposal.routeKey === ACTION_DRAFT_ROUTE ? (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <PowerOff className="size-3 shrink-0" aria-hidden />
            {t('proposals.actionDisabled')}
          </p>
        ) : null}
        {business ? (
          <p className="text-xs text-muted-foreground">
            {t('proposals.business', { name: business })}
          </p>
        ) : null}
      </div>
      {hasPreview ? (
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
            <div id={previewId} className="flex min-w-0 flex-col gap-1.5">
              {before ? <PreviewBlock label={t('proposals.before')} text={before} /> : null}
              {changes ? (
                <PreviewBlock label={before ? t('proposals.changes') : null} text={changes} />
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={action.destructive ? 'destructive' : 'default'}
          disabled={busy}
          onClick={() => run('approve')}
        >
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

/**
 * One proposal in the conversation: a card while pending, a status line once decided. A product
 * import keeps its own card, which turns into the import's report once decided.
 */
export function AssistantProposal({ proposal }: { proposal: AssistantProposalDto }) {
  if (proposal.kind === 'product_import') return <ImportProposalCard proposal={proposal} />;
  return proposal.status === 'pending' ? (
    <PendingProposal proposal={proposal} />
  ) : (
    <ProposalStatus proposal={proposal} />
  );
}
