import type { LlmEffort, LlmProviderDto, LlmTierRouteDto, ModelTier } from '@agent-sales/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/errors';

import { useLlmProviders, useLlmTiers, useSaveTier } from '../api/llm';

const TIERS: readonly ModelTier[] = ['basic', 'smart', 'pro', 'neo'];
const NONE = '__none';
const DEFAULT_EFFORT = '__default';

interface Target {
  providerId: string;
  model: string;
  effort: LlmEffort | null;
}

function TargetFields({
  idPrefix,
  label,
  value,
  onChange,
  providers,
  optional,
}: {
  idPrefix: string;
  label: string;
  value: Target | null;
  onChange: (value: Target | null) => void;
  providers: LlmProviderDto[];
  optional?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-sm font-medium text-muted-foreground">{label}</legend>
      <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1.3fr)_minmax(0,0.9fr)] gap-2">
        <Select
          value={value?.providerId ?? NONE}
          onValueChange={(v) =>
            onChange(
              v === NONE
                ? null
                : { providerId: v, model: value?.model ?? '', effort: value?.effort ?? null },
            )
          }
        >
          <SelectTrigger aria-label={`${label}: ${t('admin.provider')}`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {optional || !value ? (
              <SelectItem value={NONE}>
                {optional ? t('admin.noFallback') : t('admin.notConfigured')}
              </SelectItem>
            ) : null}
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id} disabled={!p.isEnabled}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          id={`${idPrefix}-model`}
          aria-label={`${label}: ${t('admin.model')}`}
          placeholder={t('admin.model')}
          disabled={!value}
          value={value?.model ?? ''}
          onChange={(e) => value && onChange({ ...value, model: e.target.value })}
          className="font-mono text-sm"
        />
        <Select
          disabled={!value}
          value={value?.effort ?? DEFAULT_EFFORT}
          onValueChange={(v) =>
            value && onChange({ ...value, effort: v === DEFAULT_EFFORT ? null : (v as LlmEffort) })
          }
        >
          <SelectTrigger aria-label={`${label}: ${t('admin.effort')}`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_EFFORT}>{t('admin.effortOptions.default')}</SelectItem>
            {(['low', 'medium', 'high'] as const).map((e) => (
              <SelectItem key={e} value={e}>
                {t(`admin.effortOptions.${e}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </fieldset>
  );
}

function TierRow({
  tier,
  route,
  providers,
}: {
  tier: ModelTier;
  route: LlmTierRouteDto | undefined;
  providers: LlmProviderDto[];
}) {
  const { t } = useTranslation();
  const save = useSaveTier();
  const [primary, setPrimary] = useState<Target | null>(route?.primary ?? null);
  const [fallback, setFallback] = useState<Target | null>(route?.fallback ?? null);

  useEffect(() => {
    setPrimary(route?.primary ?? null);
    setFallback(route?.fallback ?? null);
  }, [route]);

  const dirty =
    JSON.stringify(primary) !== JSON.stringify(route?.primary ?? null) ||
    JSON.stringify(fallback) !== JSON.stringify(route?.fallback ?? null);
  const valid = Boolean(primary?.model.trim()) && (!fallback || Boolean(fallback.model.trim()));
  const tierName = t(`settings.modelTierOptions.${tier}`);

  return (
    <li className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-end">
      <div className="flex shrink-0 items-center gap-2 lg:w-32 lg:flex-col lg:items-start lg:gap-1 lg:self-center">
        <span className="font-semibold">{tierName}</span>
        {!route ? (
          <Badge variant="secondary" className="bg-warning-soft text-warning">
            {t('admin.notConfigured')}
          </Badge>
        ) : null}
      </div>
      <div className="grid min-w-0 flex-1 gap-4 xl:grid-cols-2">
        <TargetFields
          idPrefix={`${tier}-primary`}
          label={t('admin.primary')}
          value={primary}
          onChange={setPrimary}
          providers={providers}
        />
        <TargetFields
          idPrefix={`${tier}-fallback`}
          label={t('admin.fallback')}
          value={fallback}
          onChange={setFallback}
          providers={providers}
          optional
        />
      </div>
      <Button
        className="shrink-0 lg:mb-0.5"
        disabled={!dirty || !valid || save.isPending}
        onClick={() =>
          primary &&
          save.mutate(
            {
              tier,
              route: {
                primary: { ...primary, model: primary.model.trim() },
                fallback: fallback ? { ...fallback, model: fallback.model.trim() } : null,
              },
            },
            {
              onSuccess: () => toast.success(t('admin.tierSaved', { tier: tierName })),
              onError: (err) => toast.error(errorMessage(t, err)),
            },
          )
        }
      >
        {t('admin.saveTier')}
      </Button>
    </li>
  );
}

export function TierRoutes() {
  const { t } = useTranslation();
  const tiers = useLlmTiers();
  const providers = useLlmProviders();

  return (
    <section>
      <h2 className="text-lg font-semibold">{t('admin.tiers')}</h2>
      <p className="mt-1 text-muted-foreground">{t('admin.tiersHint')}</p>
      <div className="mt-4">
        {tiers.isPending || providers.isPending ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : (
          <ul className="divide-y rounded-xl border">
            {TIERS.map((tier) => (
              <TierRow
                key={tier}
                tier={tier}
                route={tiers.data?.find((r) => r.tier === tier)}
                providers={providers.data ?? []}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
