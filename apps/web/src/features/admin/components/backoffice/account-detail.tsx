import {
  type AdminAccountDetail,
  type AdminOverrideDto,
  type EntitlementKey,
  ENTITLEMENT_KEYS,
} from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { ArrowLeft } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiClientError } from '@/lib/api-client';
import { formatDay, formatNumber, isoDate } from '@/lib/format';

import { useAdminAccount, useDeleteOverride, useSetAccountStatus } from '../../api/backoffice';
import { toastAdminError } from '../../lib/mutation-error';
import { ChangePlanDialog, ExtendTrialDialog, OverrideDialog } from './account-dialogs';
import { AuditCard, BusinessesCard, PaymentsCard } from './account-cards';
import { CreatePaymentDialog } from './payment-parts';
import { ReasonDialog } from './reason-dialog';
import { AccountStatusBadge, SubscriptionBadge } from './status-badges';

type Dialog =
  | { kind: 'plan' }
  | { kind: 'trial' }
  | { kind: 'override'; override: AdminOverrideDto | null }
  | { kind: 'removeOverride'; key: string }
  | { kind: 'status' }
  | { kind: 'payment' }
  | null;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

/** The local calendar day of an instant, e.g. 03/11/2026. */
const dayOf = (iso: string) => formatDay(isoDate(new Date(iso)));

/** Renders an override value by its entitlement kind. */
function entitlementValue(t: TFunction<'backoffice'>, key: string, value: unknown): string {
  const kind = ENTITLEMENT_KEYS[key as EntitlementKey];
  if (kind === 'flag') return value ? t('common.yes') : t('common.no');
  if (kind === 'limit') return value === null ? t('common.unlimited') : formatNumber(Number(value));
  if (kind === 'models') return Array.isArray(value) ? value.join(', ') : '';
  if (kind === 'allowance' && value && typeof value === 'object') {
    const a = value as { amount: number; periodDays: number };
    return `${formatNumber(a.amount)} / ${t('common.days', { count: a.periodDays })}`;
  }
  return JSON.stringify(value);
}

/** One account: plan, usage, businesses, overrides, payments and the admin log (ADR-021 §6). */
export function AccountDetail({ accountId }: { accountId: string }) {
  const { t } = useTranslation('backoffice');
  const account = useAdminAccount(accountId);
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };

  if (account.isPending) return <Skeleton className="h-96 w-full" />;
  if (account.isError) {
    const notFound = account.error instanceof ApiClientError && account.error.status === 404;
    return (
      <div className="flex flex-col items-start gap-3">
        <BackLink />
        <p className={notFound ? 'text-muted-foreground' : 'text-sm text-destructive'}>
          {notFound ? t('account.notFound') : t('common.loadError')}
        </p>
        {notFound ? null : (
          <Button variant="outline" size="sm" onClick={() => account.refetch()}>
            {t('common.retry')}
          </Button>
        )}
      </div>
    );
  }

  const a = account.data;
  return (
    <div className="flex w-full flex-col gap-6">
      <BackLink />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{a.name}</h1>
            <AccountStatusBadge status={a.status} />
          </div>
          {a.owner ? (
            <p className="mt-1 text-muted-foreground">
              {a.owner.name} · {a.owner.email}
              {a.owner.phone ? ` · ${a.owner.phone}` : ''}
            </p>
          ) : null}
          {a.status === 'suspended' && a.statusReason ? (
            <p className="mt-1 text-sm text-destructive">
              {t('account.statusReason', { reason: a.statusReason })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDialog({ kind: 'payment' })}>
            {t('account.actions.createPayment')}
          </Button>
          <Button
            variant={a.status === 'active' ? 'destructive' : 'default'}
            onClick={() => setDialog({ kind: 'status' })}
          >
            {a.status === 'active' ? t('account.actions.suspend') : t('account.actions.reactivate')}
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <SubscriptionCard account={a} onAction={setDialog} />
        <OverridesCard account={a} onAction={setDialog} />
        <BusinessesCard account={a} />
        <PaymentsCard account={a} />
      </div>
      <AuditCard account={a} />

      <ChangePlanDialog account={a} open={dialog?.kind === 'plan'} onOpenChange={close} />
      <ExtendTrialDialog account={a} open={dialog?.kind === 'trial'} onOpenChange={close} />
      <OverrideDialog
        accountId={a.id}
        override={dialog?.kind === 'override' ? dialog.override : null}
        open={dialog?.kind === 'override'}
        onOpenChange={close}
      />
      <RemoveOverrideDialog
        accountId={a.id}
        overrideKey={dialog?.kind === 'removeOverride' ? dialog.key : null}
        onOpenChange={close}
      />
      <StatusDialog account={a} open={dialog?.kind === 'status'} onOpenChange={close} />
      <CreatePaymentDialog
        accountId={a.id}
        open={dialog?.kind === 'payment'}
        onOpenChange={close}
      />
    </div>
  );
}

function BackLink() {
  const { t } = useTranslation('backoffice');
  return (
    <Link
      to="/admin/accounts"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      {t('account.back')}
    </Link>
  );
}

function SubscriptionCard({
  account,
  onAction,
}: {
  account: AdminAccountDetail;
  onAction: (d: Dialog) => void;
}) {
  const { t } = useTranslation('backoffice');
  const sub = account.subscription;
  const usage = account.usage;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.subscription')}</CardTitle>
        <CardAction className="flex flex-wrap gap-2">
          {sub?.status === 'trialing' ? (
            <Button size="sm" variant="outline" onClick={() => onAction({ kind: 'trial' })}>
              {t('account.actions.extendTrial')}
            </Button>
          ) : null}
          <Button size="sm" onClick={() => onAction({ kind: 'plan' })}>
            {t('account.actions.changePlan')}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {sub ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold">
                {sub.plan.name} · v{sub.plan.version}
              </span>
              <SubscriptionBadge status={sub.status} />
            </div>
            {sub.effectivePlan.code !== sub.plan.code ? (
              <p className="text-sm text-muted-foreground">
                {t('account.effectivePlan', { name: sub.effectivePlan.name })}
              </p>
            ) : null}
            <dl className="grid grid-cols-3 gap-3">
              <Field label={t('account.period')}>
                {sub.periodMonths ? t('common.months', { count: sub.periodMonths }) : '—'}
              </Field>
              <Field label={t('account.periodStart')}>{dayOf(sub.periodStart)}</Field>
              <Field label={t('account.periodEnd')}>
                {sub.periodEnd ? dayOf(sub.periodEnd) : '—'}
              </Field>
            </dl>
          </>
        ) : (
          <p className="text-muted-foreground">{t('account.noSubscription')}</p>
        )}
        {usage ? (
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-sm">
              <span>{t('account.usage')}</span>
              <span className="tabular-nums">
                {t('account.usageValue', {
                  used: formatNumber(usage.used),
                  limit: formatNumber(usage.limit),
                })}
              </span>
            </div>
            <Progress
              value={usage.limit > 0 ? Math.min(100, (usage.used / usage.limit) * 100) : 0}
              aria-label={t('account.usage')}
            />
            <p className="text-sm text-muted-foreground">
              {t('account.cycleEnds', { date: dayOf(usage.cycleEnd) })}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function OverridesCard({
  account,
  onAction,
}: {
  account: AdminAccountDetail;
  onAction: (d: Dialog) => void;
}) {
  const { t } = useTranslation('backoffice');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.overrides')}</CardTitle>
        <CardAction>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAction({ kind: 'override', override: null })}
          >
            {t('account.actions.addOverride')}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {account.overrides.length === 0 ? (
          <p className="text-muted-foreground">{t('account.noOverrides')}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {account.overrides.map((o) => (
              <li key={o.key} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {t(`entitlements.${o.key}`, { defaultValue: o.key })}:{' '}
                    {entitlementValue(t, o.key, o.value)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {o.expiresAt
                      ? t('account.expires', { date: dayOf(o.expiresAt) })
                      : t('account.noExpiry')}{' '}
                    · {o.reason}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onAction({ kind: 'override', override: o })}
                  >
                    {t('account.actions.editOverride')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => onAction({ kind: 'removeOverride', key: o.key })}
                  >
                    {t('account.actions.removeOverride')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RemoveOverrideDialog({
  accountId,
  overrideKey,
  onOpenChange,
}: {
  accountId: string;
  overrideKey: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('backoffice');
  const remove = useDeleteOverride(accountId);
  return (
    <ReasonDialog
      open={overrideKey !== null}
      onOpenChange={onOpenChange}
      title={t('account.overrideDialog.removeTitle', {
        key: overrideKey ? t(`entitlements.${overrideKey}`, { defaultValue: overrideKey }) : '',
      })}
      confirmLabel={t('account.actions.removeOverride')}
      destructive
      pending={remove.isPending}
      onConfirm={(reason) =>
        overrideKey &&
        remove.mutate(
          { key: overrideKey, reason },
          {
            onSuccess: () => {
              toast.success(t('common.saved'));
              onOpenChange(false);
            },
            onError: (err) => toastAdminError(t as TFunction, err),
          },
        )
      }
    />
  );
}

function StatusDialog({
  account,
  open,
  onOpenChange,
}: {
  account: AdminAccountDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('backoffice');
  const setStatus = useSetAccountStatus(account.id);
  const suspending = account.status === 'active';
  return (
    <ReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(
        suspending ? 'account.statusDialog.suspendTitle' : 'account.statusDialog.reactivateTitle',
        {
          name: account.name,
        },
      )}
      description={suspending ? t('account.statusDialog.pendingEnforcement') : undefined}
      confirmLabel={suspending ? t('account.actions.suspend') : t('account.actions.reactivate')}
      destructive={suspending}
      pending={setStatus.isPending}
      onConfirm={(reason) =>
        setStatus.mutate(
          { status: suspending ? 'suspended' : 'active', reason },
          {
            onSuccess: () => {
              toast.success(t('common.saved'));
              onOpenChange(false);
            },
            onError: (err) => toastAdminError(t as TFunction, err),
          },
        )
      }
    />
  );
}
