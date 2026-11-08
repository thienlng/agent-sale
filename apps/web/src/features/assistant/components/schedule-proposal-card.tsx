import {
  type AssistantProposalDto,
  Cadence,
  ScheduleChannel,
  ScheduleMode,
  ScheduleTemplate,
} from '@agent-sales/contracts';
import { CalendarClock, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

import { useBusinessName } from '../hooks/use-businesses';
import { useProposalDecider } from '../hooks/use-proposal-decider';
import { cadenceText } from '../utils/cadence-text';

/** What the card reads from a schedule proposal's preview; anything else is ignored. */
const SchedulePreviewShape = z.object({
  draft: z.object({
    name: z.string(),
    template: ScheduleTemplate,
    mode: ScheduleMode,
    cadence: Cadence,
    channels: z.array(ScheduleChannel),
  }),
  before: z.object({ cadence: Cadence }).partial().nullish(),
  nextRuns: z.array(z.string()).default([]),
});

type ScheduleOp = 'create' | 'edit' | 'remove';

/** `SCHEDULE create|edit|remove`, read from the route key, never from the model's summary. */
function scheduleOp(routeKey: string): ScheduleOp {
  const op = routeKey.trim().split(/\s+/)[1];
  return op === 'edit' || op === 'remove' ? op : 'create';
}

/**
 * A pending schedule proposal (T-172): the change (create, edit, remove), the schedule's name,
 * template, cadence in words, channels and the next three run times, then Áp dụng / Bỏ.
 */
export function ScheduleProposalCard({ proposal }: { proposal: AssistantProposalDto }) {
  const { t } = useTranslation('assistant');
  const business = useBusinessName(proposal.businessId);
  const { busy, applying, run } = useProposalDecider(proposal);
  const op = scheduleOp(proposal.routeKey);
  const destructive = op === 'remove';
  const preview = SchedulePreviewShape.safeParse(proposal.preview);
  const p = preview.success ? preview.data : null;
  const beforeCadence = p?.before?.cadence;
  return (
    <li
      className={cn(
        'flex w-[92%] min-w-0 flex-col gap-2 self-start rounded-xl border px-3 py-2.5',
        destructive
          ? 'border-destructive/50 bg-destructive/5'
          : 'border-primary/30 bg-primary-soft/40',
      )}
      aria-label={t('schedules.proposal.label')}
      data-destructive={destructive || undefined}
    >
      <div className="min-w-0">
        <p
          className={cn(
            'flex items-center gap-1 text-xs font-medium tracking-wide uppercase',
            destructive ? 'text-destructive' : 'text-brand-text',
          )}
        >
          <CalendarClock className="size-3.5" aria-hidden />
          {t(`schedules.proposal.ops.${op}`)}
        </p>
        <p className="mt-1 font-medium break-words">{proposal.summary}</p>
        {business ? (
          <p className="text-xs text-muted-foreground">
            {t('proposals.business', { name: business })}
          </p>
        ) : null}
      </div>
      {p ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-background px-2 py-1.5 text-xs">
          <dt className="text-muted-foreground">{t('schedules.fields.name')}</dt>
          <dd className="min-w-0 break-words">{p.draft.name}</dd>
          <dt className="text-muted-foreground">{t('schedules.fields.template')}</dt>
          <dd className="min-w-0">
            {t(`schedules.templates.${p.draft.template}`)}
            {p.draft.mode === 'alert' ? ` · ${t('schedules.modes.alert')}` : ''}
          </dd>
          <dt className="text-muted-foreground">{t('schedules.fields.cadence')}</dt>
          <dd className="min-w-0" data-testid="proposal-cadence">
            {cadenceText(p.draft.cadence, t)}
            {beforeCadence && op === 'edit' ? (
              <span className="block text-muted-foreground">
                {t('schedules.proposal.before', { cadence: cadenceText(beforeCadence, t) })}
              </span>
            ) : null}
          </dd>
          <dt className="text-muted-foreground">{t('schedules.fields.channels')}</dt>
          <dd className="min-w-0">
            {p.draft.channels.map((c) => t(`schedules.channels.${c}`)).join(', ')}
          </dd>
          {op !== 'remove' && p.nextRuns.length ? (
            <>
              <dt className="text-muted-foreground">{t('schedules.proposal.nextRuns')}</dt>
              <dd className="min-w-0">
                <ul data-testid="proposal-next-runs">
                  {p.nextRuns.map((at) => (
                    <li key={at}>{formatDateTime(at)}</li>
                  ))}
                </ul>
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={destructive ? 'destructive' : 'default'}
          disabled={busy}
          onClick={() => run('approve')}
        >
          {applying ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {applying ? t('proposals.applying') : t('proposals.apply')}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run('reject')}>
          {t('proposals.reject')}
        </Button>
      </div>
    </li>
  );
}
