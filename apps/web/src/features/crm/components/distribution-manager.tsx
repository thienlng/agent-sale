import type { AssignmentPolicyDto, CrmOptionDto } from '@agent-sales/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';

import { useAssignmentPolicies, usePutAssignmentPolicy } from '../api/crm';
import { crmErrorMessage } from '../hooks/crm-errors';
import { useCrmLookups } from '../hooks/use-crm-lookups';
import { OptionBadge } from './crm-badges';

function PolicyCard({
  source,
  policy,
  members,
}: {
  source: CrmOptionDto;
  policy: AssignmentPolicyDto;
  members: Array<{ userId: string; name: string }>;
}) {
  const { t } = useTranslation();
  const put = usePutAssignmentPolicy();
  const [enabled, setEnabled] = useState(policy.enabled);
  const [weights, setWeights] = useState<Record<string, number>>(
    Object.fromEntries(policy.candidates.map((c) => [c.userId, c.weight])),
  );
  const chosen = members.filter((m) => weights[m.userId] !== undefined);
  const total = chosen.reduce((n, m) => n + (weights[m.userId] ?? 0), 0);
  const valid = !enabled || chosen.length > 0;

  const save = () =>
    put.mutate(
      {
        sourceId: source.id,
        body: {
          enabled,
          candidates: chosen.map((m) => ({ userId: m.userId, weight: weights[m.userId] ?? 1 })),
          expectedVersion: policy.version,
        },
      },
      {
        onSuccess: () => toast.success(t('crm.distribution.saved')),
        onError: (err) => toast.error(crmErrorMessage(t, err)),
      },
    );

  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <OptionBadge option={source} />
        <div className="flex items-center gap-2">
          <Switch
            id={`dist-${source.id}`}
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label={`${t('crm.distribution.enabled')}: ${source.name}`}
          />
          <Label htmlFor={`dist-${source.id}`} className="font-normal">
            {enabled ? t('crm.distribution.on') : t('crm.distribution.off')}
          </Label>
        </div>
      </div>
      {enabled ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm text-muted-foreground">
            {t('crm.distribution.members')}
          </legend>
          {members.map((m) => {
            const on = weights[m.userId] !== undefined;
            const weight = weights[m.userId] ?? 1;
            return (
              <div key={m.userId} className="flex flex-wrap items-center gap-3">
                <label className="flex min-w-48 flex-1 items-center gap-2 text-sm">
                  <Checkbox
                    checked={on}
                    onCheckedChange={(c) => {
                      const next = { ...weights };
                      if (c === true) next[m.userId] = 1;
                      else delete next[m.userId];
                      setWeights(next);
                    }}
                  />
                  <span className="truncate">{m.name}</span>
                </label>
                {on ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      className="h-8 w-20"
                      aria-label={`${t('crm.distribution.weight')}: ${m.name}`}
                      value={weight}
                      onChange={(e) =>
                        setWeights({
                          ...weights,
                          [m.userId]: Math.min(10, Math.max(1, Number(e.target.value) || 1)),
                        })
                      }
                    />
                    <span className="w-12 text-sm text-muted-foreground tabular-nums">
                      {t('crm.distribution.share', {
                        percent: total ? Math.round((weight / total) * 100) : 0,
                      })}
                    </span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </fieldset>
      ) : null}
      <div className="flex justify-end">
        <Button size="sm" disabled={!valid || put.isPending} onClick={save}>
          {t('crm.distribution.save')}
        </Button>
      </div>
    </li>
  );
}

/** Per-source auto-assignment of new customers to Sales (SET-02, T-033). */
export function DistributionManager() {
  const { t } = useTranslation();
  const lookups = useCrmLookups();
  const policies = useAssignmentPolicies();
  if (!policies.data) return <Skeleton className="h-64 rounded-xl" />;
  const members = lookups.assignees.map((m) => ({ userId: m.userId, name: m.name }));
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('crm.distribution.hint')}</p>
      {members.length <= 1 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          {t('crm.distribution.noMembers')}
        </p>
      ) : null}
      <ul className="grid gap-3 lg:grid-cols-2">
        {policies.data.flatMap((p) => {
          const source = lookups.source(p.sourceId);
          return source ? (
            <PolicyCard
              key={`${p.sourceId}:${p.version}`}
              source={source}
              policy={p}
              members={members}
            />
          ) : (
            []
          );
        })}
      </ul>
    </div>
  );
}
