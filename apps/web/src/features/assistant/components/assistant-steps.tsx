import type { AssistantStepDto } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import { useAssistantRun } from '../api/assistant';

/** The trace of one turn: each model call or tool with how long it took. */
export function AssistantStepList({ steps }: { steps: readonly AssistantStepDto[] }) {
  const { t } = useTranslation('assistant');
  if (!steps.length) return <p className="text-xs text-muted-foreground">{t('noSteps')}</p>;
  return (
    <ol className="flex flex-col gap-1 text-xs">
      {steps.map((step) => (
        <li
          key={step.idx}
          className={cn(
            'flex min-w-0 items-center justify-between gap-3',
            step.ok === false ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          <span className="min-w-0 truncate font-mono">
            {step.toolName ?? t(`stepKinds.${step.kind}`, { defaultValue: step.kind })}
            {step.ok === false ? ` · ${t('stepFailed')}` : null}
          </span>
          {step.ms !== null ? (
            <span className="shrink-0 tabular-nums">{t('ms', { ms: step.ms })}</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** "Xem các bước" under an answer: loads the run (`GET /assistant/runs/{id}`) when opened. */
export function AssistantSteps({ runId }: { runId: string }) {
  const { t } = useTranslation('assistant');
  const run = useAssistantRun(runId);
  if (run.isPending) return <p className="text-xs text-muted-foreground">{t('stepsLoading')}</p>;
  if (run.isError) return <p className="text-xs text-destructive">{t('loadError')}</p>;
  return <AssistantStepList steps={run.data.steps} />;
}
