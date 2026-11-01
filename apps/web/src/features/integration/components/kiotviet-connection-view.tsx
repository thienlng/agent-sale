import type { ConnectionDto } from '@agent-sales/contracts';
import { KeyRound, LoaderCircle, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ApiClientError } from '@/lib/api-client';
import { formatNumber, formatRelativeTime } from '@/lib/format';

import {
  useDisconnectKiotViet,
  useKiotVietLog,
  useSyncKiotViet,
  useUpdateKiotViet,
} from '../api/integrations';
import { type BranchErrors, type BranchSelection, validateSelection } from '../lib/branches';
import { describeFailure } from '../lib/errors';
import { BranchPicker } from './branch-picker';
import { ConnectionStatusBadge } from './connection-status-badge';
import { KiotVietLogo } from './kiotviet-logo';
import { LastError } from './last-error';
import { SyncLogList } from './sync-log-list';
import { UpdateCredentialsDialog } from './update-credentials-dialog';
import { SyncToggles } from './wizard-review-step';

/** The KiotViet connection (spec §6.4). Without `settings.manage` everything is read-only. */
export function KiotVietConnectionView({
  connection,
  canManage,
}: {
  connection: ConnectionDto;
  canManage: boolean;
}) {
  const { t } = useTranslation('integration');
  const syncing = connection.status === 'syncing';
  const log = useKiotVietLog(true, syncing);
  const [updatingCredentials, setUpdatingCredentials] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const showError = connection.lastError !== null && connection.status === 'error';
  const showAuthFix = showError && canManage && connection.lastError?.code === 'auth_failed';
  // A half-made connection never syncs: the only fix is to disconnect and connect again.
  const showReconnectFix =
    showError && canManage && connection.lastError?.code === 'connect_failed';

  return (
    <div className="flex flex-col gap-6">
      <StatusHeader
        connection={connection}
        canManage={canManage}
        // When KiotViet rejected the secret, the error card carries the (primary) button instead.
        onUpdateCredentials={showAuthFix ? null : () => setUpdatingCredentials(true)}
      />
      {showError && connection.lastError ? (
        <LastError
          code={connection.lastError.code}
          fix={showAuthFix ? 'credentials' : showReconnectFix ? 'disconnect' : null}
          onFix={() => (showAuthFix ? setUpdatingCredentials(true) : setConfirmingDisconnect(true))}
        />
      ) : null}
      {syncing ? <SyncProgressCard progress={connection.progress} /> : null}
      <Stats counts={connection.counts} />
      <SettingsCard
        key={`settings-${connection.version}`}
        connection={connection}
        canManage={canManage}
      />
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t('connection.activity')}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SyncLogList entries={log.data} loading={log.isPending} failed={log.isError} />
        </CardContent>
      </Card>
      {canManage ? (
        <DangerCard
          confirming={confirmingDisconnect}
          onConfirmingChange={setConfirmingDisconnect}
        />
      ) : null}
      {canManage ? (
        <UpdateCredentialsDialog
          connection={connection}
          open={updatingCredentials}
          onOpenChange={setUpdatingCredentials}
        />
      ) : null}
    </div>
  );
}

function StatusHeader({
  connection,
  canManage,
  onUpdateCredentials,
}: {
  connection: ConnectionDto;
  canManage: boolean;
  onUpdateCredentials: (() => void) | null;
}) {
  const { t } = useTranslation('integration');
  const sync = useSyncKiotViet();
  const syncing = connection.status === 'syncing';
  const syncNow = () =>
    sync.mutate(undefined, {
      onSuccess: () => toast.success(t('connection.syncStarted')),
      onError: (error) => toast.error(syncFailure(error)),
    });
  function syncFailure(error: unknown): string {
    if (error instanceof ApiClientError && error.status === 409) {
      // A connection whose connect step failed cannot sync; anything else is a sync in progress.
      return error.details?.['reason'] === 'connect_failed'
        ? t('log.connect_failed')
        : t('connection.syncRunning');
    }
    return describeFailure(t, error).banner ?? t('wizard.errors.generic');
  }
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <KiotVietLogo />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold break-all">{connection.retailer}</h2>
              <ConnectionStatusBadge status={connection.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {connection.lastSyncAt
                ? t('connection.lastSync', { time: formatRelativeTime(connection.lastSyncAt) })
                : t('connection.neverSynced')}
              {' · '}
              {t('connection.clientId', { masked: connection.clientIdMasked })}
            </p>
          </div>
        </div>
        {canManage ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            {onUpdateCredentials ? (
              <Button variant="outline" className="h-11" onClick={onUpdateCredentials}>
                <KeyRound aria-hidden />
                {t('connection.updateCredentials')}
              </Button>
            ) : null}
            <Button className="h-11" disabled={syncing || sync.isPending} onClick={syncNow}>
              {sync.isPending ? (
                <LoaderCircle aria-hidden className="motion-safe:animate-spin" />
              ) : (
                <RefreshCw aria-hidden />
              )}
              {t('connection.syncNow')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SyncProgressCard({ progress }: { progress: ConnectionDto['progress'] }) {
  const { t } = useTranslation('integration');
  let label = t('connection.progress.preparing');
  let percent: number | null = null;
  if (progress?.phase === 'products') {
    if (progress.total) {
      label = t('connection.progress.products', {
        done: formatNumber(progress.done),
        total: formatNumber(progress.total),
      });
      percent = Math.min(100, Math.round((progress.done / progress.total) * 100));
    } else {
      label = t('connection.progress.productsCount', { done: formatNumber(progress.done) });
    }
  } else if (progress?.phase === 'stock') {
    label = t('connection.progress.stock');
  }
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-sm font-medium tabular-nums" aria-live="polite">
          <LoaderCircle aria-hidden className="size-4 text-primary motion-safe:animate-spin" />
          {label}
        </p>
        {percent !== null ? <Progress value={percent} className="h-2" aria-label={label} /> : null}
        <p className="text-sm text-muted-foreground">{t('connection.progress.leave')}</p>
      </CardContent>
    </Card>
  );
}

function Stats({ counts }: { counts: ConnectionDto['counts'] }) {
  const { t } = useTranslation('integration');
  const tiles = [
    ['products', counts.products],
    ['customers', counts.customers],
    ['orders', counts.ordersPushed],
  ] as const;
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {tiles.map(([key, value]) => (
        <div
          key={key}
          className="flex flex-col gap-1 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
        >
          <dt className="text-sm text-muted-foreground">{t(`connection.stats.${key}`)}</dt>
          <dd className="text-2xl font-semibold tabular-nums">{formatNumber(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function SettingsCard({
  connection,
  canManage,
}: {
  connection: ConnectionDto;
  canManage: boolean;
}) {
  const { t } = useTranslation('integration');
  const update = useUpdateKiotViet();
  const [selection, setSelection] = useState<BranchSelection>({
    saleBranchIds: connection.settings.saleBranchIds,
    orderBranchId: connection.settings.orderBranchId,
  });
  const [pushOrders, setPushOrders] = useState(connection.settings.pushOrders);
  const [errors, setErrors] = useState<BranchErrors>({});
  const [attempt, setAttempt] = useState(0);
  const dirty =
    pushOrders !== connection.settings.pushOrders ||
    selection.orderBranchId !== connection.settings.orderBranchId ||
    selection.saleBranchIds.length !== connection.settings.saleBranchIds.length ||
    selection.saleBranchIds.some((id) => !connection.settings.saleBranchIds.includes(id));

  function save() {
    const invalid = validateSelection(selection, {
      branches: t('wizard.errors.branchesRequired'),
      orderBranch: t('wizard.errors.orderBranchRequired'),
    });
    setErrors(invalid);
    if (invalid.branches || invalid.orderBranch || selection.orderBranchId === null) {
      setAttempt((n) => n + 1);
      return;
    }
    update.mutate(
      {
        settings: {
          ...connection.settings,
          saleBranchIds: selection.saleBranchIds,
          orderBranchId: selection.orderBranchId,
          pushOrders,
        },
        version: connection.version,
      },
      {
        onSuccess: () => toast.success(t('connection.saved')),
        onError: (error) => {
          const failure = describeFailure(t, error);
          if (failure.branches) {
            setErrors({ branches: failure.branches });
            setAttempt((n) => n + 1);
          } else if (failure.conflict) toast.error(t('connection.conflict'));
          else toast.error(failure.banner ?? t('wizard.errors.generic'));
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('connection.settings')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <BranchPicker
          branches={connection.branches}
          value={selection}
          errors={errors}
          attempt={attempt}
          disabled={!canManage || update.isPending}
          onChange={(next) => {
            setSelection(next);
            setErrors({});
          }}
        />
        <SyncToggles
          pushOrders={pushOrders}
          onPushOrdersChange={setPushOrders}
          disabled={!canManage || update.isPending}
        />
        {canManage ? (
          <Button className="h-11 self-start" disabled={!dirty || update.isPending} onClick={save}>
            {update.isPending ? (
              <LoaderCircle aria-hidden className="motion-safe:animate-spin" />
            ) : null}
            {t('connection.save')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The confirm dialog is controlled by the view, so the `connect_failed` error card can open it. */
function DangerCard({
  confirming,
  onConfirmingChange: setConfirming,
}: {
  confirming: boolean;
  onConfirmingChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('integration');
  const disconnect = useDisconnectKiotViet();
  const confirm = () =>
    disconnect.mutate(undefined, {
      onSuccess: () => {
        setConfirming(false);
        toast.success(t('connection.disconnected'));
      },
      onError: (error) => {
        setConfirming(false);
        toast.error(describeFailure(t, error).banner ?? t('wizard.errors.generic'));
      },
    });
  return (
    <Card className="ring-destructive/30">
      <CardHeader>
        <CardTitle>
          <h2>{t('connection.danger')}</h2>
        </CardTitle>
        <CardDescription>{t('connection.dangerHelp')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" className="h-11" onClick={() => setConfirming(true)}>
          {t('connection.danger')}
        </Button>
      </CardContent>
      <AlertDialog
        open={confirming}
        onOpenChange={(open) => !disconnect.isPending && setConfirming(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('connection.confirmDisconnect')}</AlertDialogTitle>
            <AlertDialogDescription>{t('connection.dangerHelp')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11" disabled={disconnect.isPending}>
              {t('connection.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className="h-11"
              disabled={disconnect.isPending}
              onClick={(e) => {
                e.preventDefault();
                confirm();
              }}
            >
              {disconnect.isPending ? (
                <LoaderCircle aria-hidden className="motion-safe:animate-spin" />
              ) : null}
              {t('connection.danger')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
