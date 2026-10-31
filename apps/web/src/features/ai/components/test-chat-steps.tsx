import type { PlaygroundResponse } from '@agent-sales/contracts';
import { ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

type Step = NonNullable<PlaygroundResponse['steps']>[number];

/** A quiet, collapsed list of what the bot did during a turn (kinds and names only). */
export function TestChatSteps({ steps }: { steps: readonly Step[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (!steps.length) return null;
  return (
    <div className="text-xs text-muted-foreground">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <ChevronRight
          className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
          aria-hidden
        />
        {t('playground.steps.title')}
        <span aria-hidden>({steps.length})</span>
      </button>
      {open ? (
        <ol id={listId} className="mt-1 flex flex-col gap-0.5 border-l pl-3">
          {steps.map((step, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
              <span>{step.kind}</span>
              {step.name ? <span className="font-mono text-foreground/80">{step.name}</span> : null}
              {step.ok === undefined ? null : (
                <span className={step.ok ? 'text-success' : 'text-destructive'}>
                  {t(step.ok ? 'playground.steps.ok' : 'playground.steps.failed')}
                </span>
              )}
              {step.ms === undefined ? null : (
                <span className="tabular-nums">
                  {t('playground.steps.ms', { ms: Math.round(step.ms) })}
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
