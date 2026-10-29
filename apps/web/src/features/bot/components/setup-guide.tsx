import { Link } from '@tanstack/react-router';
import { ChevronRight, CircleCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import type { SetupStep } from '../utils/setup-steps';

const RADIUS = 34;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** "done/total" ring; the arc grows with the finished steps. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const { t } = useTranslation('training');
  return (
    <div
      role="img"
      aria-label={t('space.home.progress', { done, total })}
      className="relative grid size-20 shrink-0 place-items-center"
    >
      <svg viewBox="0 0 80 80" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="40" cy="40" r={RADIUS} fill="none" strokeWidth="6" className="stroke-muted" />
        <circle
          cx="40"
          cy="40"
          r={RADIUS}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - (total ? done / total : 0))}
          className="stroke-success transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <span className="text-sm font-semibold tabular-nums">
        {done}/{total}
      </span>
    </div>
  );
}

/** Bot home: the steps that give the bot enough data to go live. */
export function SetupGuide({
  botId,
  steps,
  loading,
}: {
  botId: string;
  steps: SetupStep[];
  loading: boolean;
}) {
  const { t } = useTranslation('training');
  const done = steps.filter((s) => s.done).length;

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6">
      <h1 className="text-lg font-semibold">{t('space.home.title')}</h1>
      <div className="flex items-center gap-4">
        <ProgressRing done={done} total={steps.length} />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{t('space.home.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('space.home.subtitle')}</p>
        </div>
      </div>
      <ol className="flex flex-col gap-3">
        {steps.map((step) => (
          <li key={step.key}>
            {loading ? (
              <Skeleton className="h-[68px] rounded-xl" />
            ) : (
              <Link
                to={step.to}
                params={{ botId }}
                className="flex items-center gap-3 rounded-xl border bg-muted/40 px-4 py-3 transition-colors hover:border-primary hover:bg-primary-soft focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                <CircleCheck
                  aria-hidden
                  className={cn(
                    'size-5 shrink-0',
                    step.done ? 'fill-success text-white' : 'text-muted-foreground',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className={cn('block font-semibold', step.done && 'text-success')}>
                    {t(`space.home.steps.${step.key}.title`)}
                    <span className="sr-only">
                      {' '}
                      ({step.done ? t('space.home.done') : t('space.home.todo')})
                    </span>
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {t(`space.home.steps.${step.key}.body`)}
                  </span>
                  {step.emptyCount ? (
                    <span className="block text-sm text-muted-foreground">
                      {t('space.home.steps.profile.missing', { count: step.emptyCount })}
                    </span>
                  ) : null}
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
