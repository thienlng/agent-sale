import type { AssistantMessageDto, AssistantProposalDto } from '@agent-sales/contracts';
import { ChevronDown, Loader2, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Fragment, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { FIRST_RUN_POLL_MS, useAssistantRun } from '../api/assistant';
import { useMessageFeedback } from '../api/assistant-settings';
import { NAVIGATE_FOLLOW_UP_TEXT } from '../utils/navigate-follow-up';
import { AssistantMarkdown } from './assistant-markdown';
import { AssistantProposal } from './assistant-proposals';
import { AssistantStepList, AssistantSteps } from './assistant-steps';
import rabbitUrl from '@/assets/assistant-rabbit.png';

/** Lazy, so recharts loads only when an answer has a chart (docs/16). */
const AssistantChart = lazy(() => import('./assistant-chart'));

/** 👍/👎 under an answer: pressing the chosen one again clears it. */
function AnswerFeedback({ message }: { message: AssistantMessageDto }) {
  const { t } = useTranslation('assistant');
  const feedback = useMessageFeedback();
  function press(value: 1 | -1): void {
    feedback.mutate(
      { messageId: message.id, value: message.feedback === value ? 0 : value },
      { onError: () => toast.error(t('feedback.error')) },
    );
  }
  const base =
    'inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none aria-pressed:text-primary';
  return (
    <span className="ml-auto inline-flex items-center gap-0.5">
      <button
        type="button"
        className={base}
        aria-label={t('feedback.up')}
        aria-pressed={message.feedback === 1}
        onClick={() => press(1)}
      >
        <ThumbsUp className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        className={base}
        aria-label={t('feedback.down')}
        aria-pressed={message.feedback === -1}
        onClick={() => press(-1)}
      >
        <ThumbsDown className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}

function AssistantAnswer({ message }: { message: AssistantMessageDto }) {
  const { t } = useTranslation('assistant');
  const [showSteps, setShowSteps] = useState(false);
  const charts = message.uiActions.flatMap((a) => (a.type === 'chart' ? [a.chart] : []));
  return (
    <li className="flex max-w-[85%] min-w-0 flex-col gap-1 self-start">
      <div className="min-w-0 rounded-2xl rounded-bl-sm bg-muted px-3 py-2 break-words">
        <AssistantMarkdown content={message.content} />
      </div>
      {charts.map((chart, i) => (
        <Suspense key={i} fallback={<Skeleton className="h-[180px] w-full" />}>
          <AssistantChart chart={chart} />
        </Suspense>
      ))}
      <div className="flex items-center gap-2">
        {message.runId ? (
          <button
            type="button"
            aria-expanded={showSteps}
            onClick={() => setShowSteps((v) => !v)}
            className="inline-flex w-fit items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {showSteps ? t('hideSteps') : t('showSteps')}
            <ChevronDown
              className={cn('size-3 transition-transform', showSteps && 'rotate-180')}
              aria-hidden
            />
          </button>
        ) : null}
        <AnswerFeedback message={message} />
      </div>
      {message.runId && showSteps ? (
        <div className="rounded-lg border px-3 py-2">
          <AssistantSteps runId={message.runId} />
        </div>
      ) : null}
    </li>
  );
}

const NO_PROPOSALS: readonly AssistantProposalDto[] = [];

/**
 * Where each proposal shows: right after the answer of the turn that prepared it (the first
 * assistant message stored at or after it), so the answer explains the card and the decision's
 * event message follows it. Proposals with no such answer yet go at the end.
 */
function placeProposals(
  messages: readonly AssistantMessageDto[],
  proposals: readonly AssistantProposalDto[],
): { after: Map<string, AssistantProposalDto[]>; trailing: AssistantProposalDto[] } {
  const after = new Map<string, AssistantProposalDto[]>();
  const trailing: AssistantProposalDto[] = [];
  for (const proposal of proposals) {
    const at = Date.parse(proposal.createdAt);
    const answer = messages.find((m) => m.role === 'assistant' && Date.parse(m.createdAt) >= at);
    if (answer) after.set(answer.id, [...(after.get(answer.id) ?? []), proposal]);
    else trailing.push(proposal);
  }
  return { after, trailing };
}

/** While a turn runs: "Đang tra cứu…" and the steps so far (polled every second). */
function LiveTurn({ turnId }: { turnId: string }) {
  const { t } = useTranslation('assistant');
  // The turn whose run may exist by now; another turn starts its own wait.
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setReady(turnId), FIRST_RUN_POLL_MS);
    return () => clearTimeout(timer);
  }, [turnId]);
  const run = useAssistantRun(ready === turnId ? turnId : null, { poll: true });
  return (
    <li className="flex max-w-[85%] min-w-0 flex-col gap-2 self-start rounded-2xl rounded-bl-sm bg-muted px-3 py-2">
      <span className="inline-flex items-center gap-2 text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {t('thinking')}
      </span>
      {run.data?.steps.length ? <AssistantStepList steps={run.data.steps} /> : null}
    </li>
  );
}

export function AssistantMessages({
  messages,
  proposals = NO_PROPOSALS,
  loading,
  pendingTurn,
  unavailable,
}: {
  messages: readonly AssistantMessageDto[];
  /** The thread's proposals (writes waiting for, or past, the owner's decision). */
  proposals?: readonly AssistantProposalDto[];
  loading: boolean;
  pendingTurn: string | null;
  unavailable: boolean;
}) {
  const { t } = useTranslation('assistant');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, proposals.length, pendingTurn, unavailable]);

  const placed = placeProposals(messages, proposals);

  if (loading)
    return (
      <div className="flex flex-1 flex-col gap-3 p-4">
        <Skeleton className="h-10 w-2/3 self-end" />
        <Skeleton className="h-16 w-3/4" />
      </div>
    );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {messages.length === 0 && proposals.length === 0 && !pendingTurn ? (
        <div className="flex flex-col items-center px-6 py-12 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-primary">
            <img src={rabbitUrl} alt="" className="size-10 object-contain" />
          </span>
          <p className="mt-4 font-semibold">{t('emptyTitle')}</p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">{t('emptyBody')}</p>
        </div>
      ) : (
        <ol className="flex flex-col gap-3 p-4">
          {messages.map((m) => (
            <Fragment key={m.id}>
              {m.role === 'user' ? (
                // The panel's own "continue on the new page" turn is not the owner's words.
                m.content === NAVIGATE_FOLLOW_UP_TEXT ? null : (
                  <li className="max-w-[85%] self-end rounded-2xl rounded-br-sm bg-primary px-3 py-2 break-words whitespace-pre-line text-primary-foreground">
                    {m.content}
                  </li>
                )
              ) : m.role === 'assistant' ? (
                <AssistantAnswer message={m} />
              ) : (
                <li className="self-center text-center text-xs whitespace-pre-line text-muted-foreground">
                  {m.content}
                </li>
              )}
              {placed.after.get(m.id)?.map((p) => (
                <AssistantProposal key={p.id} proposal={p} />
              ))}
            </Fragment>
          ))}
          {placed.trailing.map((p) => (
            <AssistantProposal key={p.id} proposal={p} />
          ))}
          {pendingTurn ? <LiveTurn turnId={pendingTurn} /> : null}
        </ol>
      )}
      {unavailable ? (
        <p
          role="alert"
          className="mx-4 mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t('unavailable')}
        </p>
      ) : null}
      <div ref={end} />
    </div>
  );
}
