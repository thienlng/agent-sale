import type { AssistantRunDto, AssistantStepDto } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';

import { RunTrace, type TraceStep, type TraceSummary } from '@/components/run-trace';

import { useAssistantRun } from '../api/assistant';

const toTraceStep = (s: AssistantStepDto): TraceStep => ({
  idx: s.idx,
  kind: s.kind,
  name: s.toolName,
  ok: s.ok,
  errorCode: s.errorCode,
  ms: s.ms,
  detail: s.detail,
});

function toSummary(run: AssistantRunDto): TraceSummary {
  const d = run.debug;
  return {
    provider: d?.provider ?? null,
    model: d?.model ?? null,
    tier: d?.tier ?? null,
    promptVersion: d?.promptVersion ?? null,
    tokens: d ? { input: d.inputTokens, cached: d.cachedTokens, output: d.outputTokens } : null,
    status: `${run.status}${run.outcome ? `/${run.outcome}` : ''}`,
    rounds: run.rounds,
    latencyMs: run.latencyMs,
    guardrail: d?.guardrail ?? null,
    runId: run.id,
  };
}

/** The assistant run's trace in the shared format (`RunTrace`); the summary when `run` is given. */
export function AssistantStepList({
  steps,
  run,
}: {
  steps: readonly AssistantStepDto[];
  run?: AssistantRunDto | undefined;
}) {
  return <RunTrace steps={steps.map(toTraceStep)} summary={run ? toSummary(run) : undefined} />;
}

/** The open trace under an answer: loads the run (`GET /assistant/runs/{id}`) when shown. */
export function AssistantSteps({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const run = useAssistantRun(runId);
  if (run.isPending) return <p className="text-xs text-muted-foreground">{t('trace.loading')}</p>;
  if (run.isError)
    return <p className="text-xs text-destructive">{t('loadError', { ns: 'assistant' })}</p>;
  return <AssistantStepList steps={run.data.steps} run={run.data} />;
}

const TOOL_PROGRESS: Record<string, string> = {
  load_skill: 'skill',
  skills_list: 'skill',
  tool_search: 'search',
  tool_describe: 'search',
  tool_call: 'read',
  session_search: 'read',
  memory: 'memory',
  import_preview: 'import',
  import_propose: 'propose',
  schedule: 'propose',
  ui_navigate: 'ui',
  ui_fill_form: 'ui',
  ui_spotlight: 'ui',
};

/** The `progress.*` key of a running turn: what its latest step is doing, in plain words (AS-9). */
export function progressKey(steps: readonly AssistantStepDto[]): string | null {
  const last = steps.at(-1);
  if (!last) return null;
  if (!last.toolName) return 'model';
  return TOOL_PROGRESS[last.toolName] ?? 'read';
}
