import type { PlaygroundResponse } from '@agent-sales/contracts';
import { BadgeCheck, CircleHelp, Headset, ShieldAlert, TriangleAlert, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/** What happened to a bot turn, shown under its bubble like a delivery receipt. */
export function Outcome({ result }: { result: PlaygroundResponse }) {
  const { t } = useTranslation();
  const used = result.sources.filter((s) => s.used);
  const chip =
    'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium';
  return (
    <div className="flex flex-col items-start gap-1.5">
      {result.outcome === 'answered'
        ? used.map((s) => (
            <span key={s.faqId} className={cn(chip, 'bg-success-soft text-success')}>
              <BadgeCheck className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{t('playground.source', { question: s.question })}</span>
            </span>
          ))
        : null}
      {result.outcome === 'fallback' ? (
        <span className={cn(chip, 'bg-warning-soft text-warning')}>
          {result.guardrail?.startsWith('ungrounded') ? (
            <ShieldAlert className="size-3.5 shrink-0" aria-hidden />
          ) : (
            <CircleHelp className="size-3.5 shrink-0" aria-hidden />
          )}
          {result.guardrail?.startsWith('ungrounded')
            ? t('playground.guardrail')
            : t('playground.fallback')}
        </span>
      ) : null}
      {result.outcome === 'handoff' ? (
        <span className={cn(chip, 'bg-secondary text-secondary-foreground')}>
          <Headset className="size-3.5 shrink-0" aria-hidden />
          {t('playground.handoff')}
        </span>
      ) : null}
      {result.actions?.map((a, i) => (
        <span
          key={`${a.name}-${i}`}
          className={cn(
            chip,
            a.ok ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning',
          )}
        >
          {a.ok ? (
            <Zap className="size-3.5 shrink-0" aria-hidden />
          ) : (
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          )}
          <span className="truncate">
            {t(a.ok ? 'chat.called' : 'chat.failed', { ns: 'action', name: a.name })}
          </span>
        </span>
      ))}
      <span className="text-xs text-muted-foreground">
        {t('playground.meta', {
          model: result.model,
          tokens:
            result.usage.inputTokens + result.usage.cachedInputTokens + result.usage.outputTokens,
          seconds: (result.latencyMs / 1000).toFixed(1),
        })}
      </span>
    </div>
  );
}
