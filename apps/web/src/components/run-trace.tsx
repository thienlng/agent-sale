import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

const num = (n: number) => n.toLocaleString('en-US');

/** One step of an agent turn, as the assistant run and the bot test chat both report it. */
export interface TraceStep {
  idx: number;
  kind: string;
  /** The tool's name; null for a model call or a loop event. */
  name: string | null;
  ok: boolean | null;
  errorCode: string | null;
  ms: number | null;
  /** A model call's tokens and requested tools, or a tool's arguments and result head. */
  detail: Record<string, unknown> | null;
}

/** The run behind a turn: model, prompt, token totals and how it went. */
export interface TraceSummary {
  provider?: string | null;
  model: string | null;
  tier?: string | null;
  promptVersion?: string | null;
  tokens?: { input: number; cached: number; output: number } | null;
  /** e.g. `done/answered`. */
  status: string;
  rounds?: number | null;
  latencyMs: number;
  guardrail?: string | null;
  runId?: string | null;
}

/** What the collapsed line under an answer says: model, total tokens and time. */
export interface TraceMeta {
  model: string | null;
  tokens: number;
  latencyMs: number;
}

interface ModelDetail {
  tokens: { input: number; cached: number; output: number };
  requested: string[];
}
interface ToolDetail {
  args: string;
  resultChars: number;
  result: string;
}

function modelDetail(d: TraceStep['detail']): ModelDetail | null {
  return d && typeof d['tokens'] === 'object' && d['tokens'] !== null
    ? (d as unknown as ModelDetail)
    : null;
}

function toolDetail(d: TraceStep['detail']): ToolDetail | null {
  return d && typeof d['args'] === 'string' ? (d as unknown as ToolDetail) : null;
}

/** One technical line per step; a step with arguments or a result opens to show them. */
function StepRow({ step }: { step: TraceStep }) {
  const { t } = useTranslation();
  const model = modelDetail(step.detail);
  const tool = toolDetail(step.detail);
  const name = step.name ?? (step.kind === 'model_call' ? 'llm' : step.kind);
  const failed = step.ok === false;
  const head = (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="w-4 shrink-0 text-right opacity-50">{step.idx}</span>
      <span className={cn('min-w-0 flex-1 truncate', step.kind === 'model_call' && 'opacity-70')}>
        {name}
        {failed ? ` ✕ ${step.errorCode ?? t('trace.failed')}` : null}
      </span>
      {model ? (
        <span className="shrink-0 opacity-70">
          {num(model.tokens.input + model.tokens.cached)}
          {model.tokens.cached ? `(${num(model.tokens.cached)}c)` : ''}→{num(model.tokens.output)}
        </span>
      ) : null}
      {tool ? <span className="shrink-0 opacity-70">{num(tool.resultChars)}ch</span> : null}
      <span className="w-14 shrink-0 text-right tabular-nums">
        {step.ms !== null ? `${num(Math.round(step.ms))}ms` : '—'}
      </span>
    </span>
  );
  const rowClass = cn(failed ? 'text-destructive' : 'text-muted-foreground');
  if (!tool && !model?.requested.length) return <li className={rowClass}>{head}</li>;
  return (
    <li className={rowClass}>
      <details className="group">
        <summary className="cursor-pointer list-none hover:text-foreground [&::-webkit-details-marker]:hidden">
          {head}
        </summary>
        <dl className="mt-0.5 mb-1 ml-6 flex flex-col gap-0.5 border-l pl-2 text-foreground/80">
          {model?.requested.length ? (
            <div>
              <dt className="inline opacity-60">{t('trace.requested')} </dt>
              <dd className="inline">{model.requested.join(', ')}</dd>
            </div>
          ) : null}
          {tool ? (
            <>
              <div>
                <dt className="opacity-60">{t('trace.args')}</dt>
                <dd className="break-all whitespace-pre-wrap">{tool.args || '—'}</dd>
              </div>
              <div>
                <dt className="opacity-60">
                  {t('trace.result', { chars: num(tool.resultChars) })}
                </dt>
                <dd className="max-h-40 overflow-y-auto break-all whitespace-pre-wrap">
                  {tool.result || '—'}
                </dd>
              </div>
            </>
          ) : null}
        </dl>
      </details>
    </li>
  );
}

/** Model, prompt, totals and outcome of the run, above its steps. */
function Summary({ summary: s, steps }: { summary: TraceSummary; steps: readonly TraceStep[] }) {
  const { t } = useTranslation();
  const tools = steps.filter((x) => x.kind === 'tool').length;
  const llm = steps.filter((x) => x.kind === 'model_call').length;
  const items: Array<[string, string]> = [
    [t('trace.model'), [s.provider, s.model].filter(Boolean).join('/') || '—'],
    ...(s.tier ? ([[t('trace.tier'), s.tier]] as Array<[string, string]>) : []),
    ...(s.promptVersion ? ([[t('trace.prompt'), s.promptVersion]] as Array<[string, string]>) : []),
    ...(s.tokens
      ? ([
          [
            t('trace.tokens'),
            `${num(s.tokens.input + s.tokens.cached)} in (${num(s.tokens.cached)} cached, ${num(s.tokens.input)} new) · ${num(s.tokens.output)} out`,
          ],
        ] as Array<[string, string]>)
      : []),
    [
      t('trace.run'),
      [
        s.status,
        typeof s.rounds === 'number' ? `${s.rounds} rounds` : null,
        `${llm} llm`,
        `${tools} tools`,
        `${num(s.latencyMs)}ms`,
      ]
        .filter(Boolean)
        .join(' · '),
    ],
    ...(s.guardrail ? ([[t('trace.guardrail'), s.guardrail]] as Array<[string, string]>) : []),
  ];
  return (
    <dl className="mb-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-b pb-1.5 text-foreground/80">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="opacity-60">{k}</dt>
          <dd className="min-w-0 break-all">{v}</dd>
        </div>
      ))}
      {s.runId ? (
        <>
          <dt className="opacity-60">{t('trace.runId')}</dt>
          <dd className="min-w-0 truncate opacity-60 select-all">{s.runId}</dd>
        </>
      ) : null}
    </dl>
  );
}

/**
 * The trace of one agent turn, the same for the owner assistant and the bot test chat: the run
 * summary, then each model call (tokens: total input incl. cache reads, `(n c)` cached, `→`
 * output) or tool (args, result head, result size in chars) with its time.
 */
export function RunTrace({
  summary,
  steps,
}: {
  summary?: TraceSummary | undefined;
  steps: readonly TraceStep[];
}) {
  const { t } = useTranslation();
  return (
    <div className="font-mono text-[11px] leading-snug">
      {summary ? <Summary summary={summary} steps={steps} /> : null}
      {steps.length ? (
        <ol className="flex flex-col gap-0.5">
          {steps.map((step) => (
            <StepRow key={step.idx} step={step} />
          ))}
        </ol>
      ) : (
        <p className="text-muted-foreground">{t('trace.noSteps')}</p>
      )}
    </div>
  );
}

/**
 * The line under an answer: "Xem các bước" with the model, total tokens and time; it opens the
 * trace below it (in a bordered box, `children`).
 */
export function RunTraceToggle({
  open,
  onToggle,
  meta,
}: {
  open: boolean;
  onToggle: () => void;
  meta: TraceMeta | null | undefined;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="inline-flex min-w-0 items-center gap-1 rounded text-left text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-offset-3 focus-visible:ring-offset-background focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="shrink-0">{open ? t('trace.hide') : t('trace.show')}</span>
      <ChevronDown
        className={cn('size-3 shrink-0 transition-transform', open && 'rotate-180')}
        aria-hidden
      />
      {meta ? (
        <span className="min-w-0 truncate tabular-nums opacity-80">
          ·{' '}
          {t('trace.meta', {
            model: meta.model ?? '—',
            tokens: num(meta.tokens),
            seconds: (meta.latencyMs / 1000).toFixed(1),
          })}
        </span>
      ) : null}
    </button>
  );
}

/** The bordered box the open trace sits in, under its answer. */
export function RunTraceBox({ children }: { children: React.ReactNode }) {
  return <div className="w-full min-w-0 rounded-lg border px-3 py-2">{children}</div>;
}
