import type { AssistantRunDto, AssistantStepDto } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import { useAssistantRun } from '../api/assistant';

const num = (n: number) => n.toLocaleString('en-US');

interface ModelDetail {
  tokens: { input: number; cached: number; output: number };
  requested: string[];
}
interface ToolDetail {
  args: string;
  resultChars: number;
  result: string;
}

function modelDetail(d: AssistantStepDto['detail']): ModelDetail | null {
  return d && typeof d['tokens'] === 'object' && d['tokens'] !== null
    ? (d as unknown as ModelDetail)
    : null;
}

function toolDetail(d: AssistantStepDto['detail']): ToolDetail | null {
  return d && typeof d['args'] === 'string' ? (d as unknown as ToolDetail) : null;
}

/** One technical line per step; a step with arguments or a result opens to show them. */
function StepRow({ step }: { step: AssistantStepDto }) {
  const { t } = useTranslation('assistant');
  const model = modelDetail(step.detail);
  const tool = toolDetail(step.detail);
  const name = step.toolName ?? (step.kind === 'model_call' ? 'llm' : step.kind);
  const failed = step.ok === false;
  const head = (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="w-4 shrink-0 text-right opacity-50">{step.idx}</span>
      <span className={cn('min-w-0 flex-1 truncate', step.kind === 'model_call' && 'opacity-70')}>
        {name}
        {failed ? ` ✕ ${step.errorCode ?? t('debug.failed')}` : null}
      </span>
      {model ? (
        <span className="shrink-0 opacity-70">
          {num(model.tokens.input + model.tokens.cached)}
          {model.tokens.cached ? `(${num(model.tokens.cached)}c)` : ''}→{num(model.tokens.output)}
        </span>
      ) : null}
      {tool ? <span className="shrink-0 opacity-70">{num(tool.resultChars)}ch</span> : null}
      <span className="w-14 shrink-0 text-right tabular-nums">
        {step.ms !== null ? `${num(step.ms)}ms` : '—'}
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
              <dt className="inline opacity-60">{t('debug.requested')} </dt>
              <dd className="inline">{model.requested.join(', ')}</dd>
            </div>
          ) : null}
          {tool ? (
            <>
              <div>
                <dt className="opacity-60">{t('debug.args')}</dt>
                <dd className="break-all whitespace-pre-wrap">{tool.args || '—'}</dd>
              </div>
              <div>
                <dt className="opacity-60">
                  {t('debug.result', { chars: num(tool.resultChars) })}
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
function RunSummary({ run }: { run: AssistantRunDto }) {
  const { t } = useTranslation('assistant');
  const d = run.debug;
  const tools = run.steps.filter((s) => s.kind === 'tool').length;
  const llm = run.steps.filter((s) => s.kind === 'model_call').length;
  const items: Array<[string, string]> = [
    ...(d
      ? ([
          [t('debug.model'), [d.provider, d.model].filter(Boolean).join('/') || '—'],
          [t('debug.tier'), d.tier],
          [t('debug.prompt'), d.promptVersion],
          [
            t('debug.tokens'),
            `${num(d.inputTokens + d.cachedTokens)} in (${num(d.cachedTokens)} cached, ${num(d.inputTokens)} new) · ${num(d.outputTokens)} out`,
          ],
        ] as Array<[string, string]>)
      : []),
    [
      t('debug.run'),
      `${run.status}${run.outcome ? `/${run.outcome}` : ''} · ${run.rounds} rounds · ${llm} llm · ${tools} tools · ${num(run.latencyMs)}ms`,
    ],
    ...(d?.guardrail ? ([[t('debug.guardrail'), d.guardrail]] as Array<[string, string]>) : []),
  ];
  return (
    <dl className="mb-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-b pb-1.5 text-foreground/80">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="opacity-60">{k}</dt>
          <dd className="min-w-0 break-all">{v}</dd>
        </div>
      ))}
      <dt className="opacity-60">{t('debug.runId')}</dt>
      <dd className="min-w-0 truncate opacity-60 select-all">{run.id}</dd>
    </dl>
  );
}

/**
 * The trace of one turn: each model call (tokens: total input incl. cache reads, `(n c)` cached,
 * `→` output) or tool (args, result head, result size in chars) with its time.
 */
export function AssistantStepList({
  steps,
  run,
}: {
  steps: readonly AssistantStepDto[];
  run?: AssistantRunDto | undefined;
}) {
  const { t } = useTranslation('assistant');
  return (
    <div className="font-mono text-[11px] leading-snug">
      {run ? <RunSummary run={run} /> : null}
      {steps.length ? (
        <ol className="flex flex-col gap-0.5">
          {steps.map((step) => (
            <StepRow key={step.idx} step={step} />
          ))}
        </ol>
      ) : (
        <p className="text-muted-foreground">{t('noSteps')}</p>
      )}
    </div>
  );
}

/** "Xem các bước" under an answer: loads the run (`GET /assistant/runs/{id}`) when opened. */
export function AssistantSteps({ runId }: { runId: string }) {
  const { t } = useTranslation('assistant');
  const run = useAssistantRun(runId);
  if (run.isPending) return <p className="text-xs text-muted-foreground">{t('stepsLoading')}</p>;
  if (run.isError) return <p className="text-xs text-destructive">{t('loadError')}</p>;
  return <AssistantStepList steps={run.data.steps} run={run.data} />;
}
