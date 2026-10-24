import type { BotReadiness } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { useReadiness } from '../api/bots';

type CheckKey = BotReadiness['checks'][number]['key'];

/** Where each unfinished step is fixed. `channel` has no page until M3. */
const TARGET: Record<CheckKey, '/app/bots/$botId/settings' | '/app/bots/$botId/knowledge' | null> =
  {
    mission: '/app/bots/$botId/settings',
    placeholders: '/app/bots/$botId/settings',
    faq: '/app/bots/$botId/knowledge',
    channel: null,
  };

/** Onboarding steps, in the order a new owner should do them. */
export function ReadinessChecklist({ botId }: { botId: string }) {
  const { t } = useTranslation();
  const readiness = useReadiness(botId);

  if (readiness.isPending) return <Skeleton className="h-72 rounded-xl" />;
  if (!readiness.data) return null;

  const { checks, missingPlaceholders } = readiness.data;
  const done = checks.filter((c) => c.done).length;
  const detail = (key: CheckKey) =>
    key === 'mission'
      ? t('readiness.missionDetail')
      : key === 'placeholders'
        ? t('readiness.placeholdersDetail', { count: missingPlaceholders.length })
        : key === 'channel'
          ? t('readiness.channelDetail')
          : null;

  return (
    <section className="rounded-xl border">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <h2 className="text-lg font-semibold">{t('readiness.title')}</h2>
        <span className="text-sm text-muted-foreground">
          {t('readiness.progress', { done, total: checks.length })}
        </span>
      </header>
      <div className="mx-5 mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500"
          style={{ width: `${(done / checks.length) * 100}%` }}
        />
      </div>
      <ol className="mt-4 divide-y border-t">
        {checks.map((c, i) => {
          const target = TARGET[c.key];
          return (
            <li key={c.key} className="flex items-start gap-4 px-5 py-4">
              <span
                className={cn(
                  'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
                  c.done ? 'bg-success text-white' : 'border border-input text-muted-foreground',
                )}
              >
                {c.done ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn('font-medium', c.done && 'text-muted-foreground line-through')}>
                  {t(`readiness.${c.key}`)}
                </p>
                {!c.done && detail(c.key) ? (
                  <p className="mt-0.5 text-sm text-muted-foreground">{detail(c.key)}</p>
                ) : null}
              </div>
              {!c.done && target ? (
                <Link
                  to={target}
                  params={{ botId }}
                  className="shrink-0 text-sm font-medium text-primary hover:underline"
                >
                  {t('readiness.go')}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
