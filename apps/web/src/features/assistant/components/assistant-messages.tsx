import type { AssistantMessageDto, AssistantProposalDto } from '@agent-sales/contracts';
import {
  BarChart3,
  Bot,
  Check,
  Compass,
  Loader2,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { Fragment, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { RunTraceBox, RunTraceToggle } from '@/components/run-trace';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { FIRST_RUN_POLL_MS, useAssistantRun } from '../api/assistant';
import { useMessageFeedback } from '../api/assistant-settings';
import { NAVIGATE_FOLLOW_UP_TEXT } from '../utils/navigate-follow-up';
import { AssistantMarkdown } from './assistant-markdown';
import { AssistantProposal } from './assistant-proposals';
import { AssistantSteps, progressKey } from './assistant-steps';

/** The assistant's feature groups on an empty conversation, four concrete abilities each. */
const GROUPS = [
  { key: 'setup', Icon: Compass },
  { key: 'insights', Icon: BarChart3 },
  { key: 'bots', Icon: Bot },
] as const;
const GROUP_ITEMS = ['a', 'b', 'c', 'd'] as const;
/** Starter questions of the empty conversation: concrete asks that send on click. */
const STARTERS = ['setup', 'revenue', 'bot', 'alert'] as const;

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
    'inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-offset-3 focus-visible:ring-offset-background focus-visible:ring-ring focus-visible:outline-none aria-pressed:text-brand-text';
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

function AssistantAnswer({
  message,
  onRetry,
}: {
  message: AssistantMessageDto;
  /** Sends the owner's question again (the busy reply of the last turn, AS-1). */
  onRetry?: (() => void) | undefined;
}) {
  const { t } = useTranslation('assistant');
  const [showSteps, setShowSteps] = useState(false);
  const charts = message.uiActions.flatMap((a) => (a.type === 'chart' ? [a.chart] : []));
  return (
    <li className="flex max-w-[85%] min-w-0 flex-col gap-1 self-start">
      <div className="min-w-0 rounded-2xl rounded-bl-sm bg-muted px-3 py-2 break-words">
        <AssistantMarkdown content={message.content} />
      </div>
      {onRetry ? (
        <Button type="button" size="sm" variant="outline" className="self-start" onClick={onRetry}>
          <RotateCcw className="size-3.5" aria-hidden />
          {t('retry')}
        </Button>
      ) : null}
      {charts.map((chart, i) => (
        <Suspense key={i} fallback={<Skeleton className="h-[180px] w-full" />}>
          <AssistantChart chart={chart} />
        </Suspense>
      ))}
      <div className="flex min-w-0 items-center justify-between gap-2">
        {message.runId ? (
          <RunTraceToggle
            open={showSteps}
            onToggle={() => setShowSteps((v) => !v)}
            meta={message.runMeta}
          />
        ) : (
          <span />
        )}
        <AnswerFeedback message={message} />
      </div>
      {message.runId && showSteps ? (
        <RunTraceBox>
          <AssistantSteps runId={message.runId} />
        </RunTraceBox>
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
  // A plain status for the owner; the step trace stays behind "Xem các bước" on the answer (AS-9).
  const steps = run.data?.steps ?? [];
  const key = progressKey(steps);
  const rounds = steps.filter((s) => !s.toolName).length;
  return (
    <li className="flex max-w-[85%] min-w-0 flex-col gap-2 self-start rounded-2xl rounded-bl-sm bg-muted px-3 py-2">
      <span className="flex items-start gap-2 text-muted-foreground" role="status">
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
        <span className="min-w-0">
          {key ? t(`progress.${key}`) : t('thinking')}
          {rounds > 1 ? (
            <span className="ml-1 text-xs whitespace-nowrap tabular-nums opacity-70">
              · {t('progress.steps', { count: rounds })}
            </span>
          ) : null}
        </span>
      </span>
    </li>
  );
}

/** How close to the bottom (px) still counts as following the conversation. */
const FOLLOW_SLACK_PX = 48;

export function AssistantMessages({
  messages,
  proposals = NO_PROPOSALS,
  loading,
  pendingTurn,
  unavailable,
  onStarter,
  onRetry,
  roomy = false,
}: {
  messages: readonly AssistantMessageDto[];
  /** The thread's proposals (writes waiting for, or past, the owner's decision). */
  proposals?: readonly AssistantProposalDto[];
  loading: boolean;
  pendingTurn: string | null;
  unavailable: boolean;
  /** Sends a starter question from the empty state; absent while a message is on its way. */
  onStarter?: ((text: string) => void) | undefined;
  /** Sends a question again after a busy reply; absent while a message is on its way. */
  onRetry?: ((text: string) => void) | undefined;
  /** The full page: a larger welcome with room for the starters in two columns. */
  roomy?: boolean;
}) {
  const { t } = useTranslation('assistant');
  const empty = messages.length === 0 && proposals.length === 0 && !pendingTurn;
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Following the bottom: true until the owner scrolls up, true again once back at the bottom.
  const following = useRef(true);
  useEffect(() => {
    following.current = true;
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, proposals.length, pendingTurn, unavailable]);
  // The running turn's step trace, a proposal card or an image grows the conversation without a
  // new message: keep the bottom in view while the owner is following it.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const onScroll = () => {
      following.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK_PX;
    };
    const grow = new ResizeObserver(() => {
      if (following.current) el.scrollTop = el.scrollHeight;
    });
    for (const child of el.children) grow.observe(child);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      grow.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, [loading, empty]);

  const placed = placeProposals(messages, proposals);
  // "Thử lại" only under the last answer, when it is the busy reply to the question before it.
  const last = messages.at(-1);
  const asked = messages.at(-2);
  const retryText =
    last?.retryable && asked?.role === 'user' && !pendingTurn ? asked.content : undefined;

  if (loading)
    return (
      <div className="flex flex-1 flex-col gap-3 p-4">
        <Skeleton className="h-10 w-2/3 self-end" />
        <Skeleton className="h-16 w-3/4" />
      </div>
    );

  return (
    <div ref={box} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {empty ? (
        <div
          data-measure
          className={cn('flex flex-col px-4', roomy ? 'min-h-full justify-center py-10' : 'py-6')}
        >
          <p
            className={cn(
              'font-semibold text-balance',
              roomy ? 'text-xl tracking-tight sm:text-2xl' : 'text-base',
            )}
          >
            {t('starters.title')}
          </p>
          <p className="mt-2 text-sm text-pretty text-muted-foreground">{t('starters.body')}</p>
          <ul
            aria-label={t('starters.groupsLabel')}
            className={cn('mt-6 grid gap-x-6 gap-y-6', roomy && 'xl:grid-cols-3')}
          >
            {GROUPS.map(({ key, Icon }) => (
              <li key={key} className="flex flex-col gap-3">
                <p className="flex items-center gap-2.5 text-sm font-semibold">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-brand-text">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  {t(`starters.groups.${key}.title`)}
                </p>
                <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                  {GROUP_ITEMS.map((item) => (
                    <li key={item} className="flex gap-2 text-pretty">
                      <Check className="mt-0.5 size-4 shrink-0 text-brand-text" aria-hidden />
                      {t(`starters.groups.${key}.items.${item}`)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-xs text-pretty text-muted-foreground">{t('starters.learning')}</p>
          <p className="mt-7 text-xs font-medium text-muted-foreground">{t('starters.label')}</p>
          <ul
            aria-label={t('starters.label')}
            className={cn('mt-2 grid gap-2', roomy && 'sm:grid-cols-2')}
          >
            {STARTERS.map((key) => (
              <li key={key}>
                <button
                  type="button"
                  disabled={!onStarter}
                  onClick={() => onStarter?.(t(`starters.items.${key}`))}
                  className="flex h-full w-full items-center rounded-xl border bg-background px-3.5 py-3 text-left text-sm transition-colors hover:border-primary/40 hover:bg-primary-soft/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60"
                >
                  {t(`starters.items.${key}`)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ol data-measure className="flex flex-col gap-3 p-4">
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
                <AssistantAnswer
                  message={m}
                  onRetry={
                    m === last && retryText !== undefined && onRetry
                      ? () => onRetry(retryText)
                      : undefined
                  }
                />
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
          data-measure
          className="mx-4 mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t('unavailable')}
        </p>
      ) : null}
      <div ref={end} />
    </div>
  );
}
