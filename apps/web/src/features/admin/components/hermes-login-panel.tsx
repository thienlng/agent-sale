import type { HermesLoginStatus } from '@agent-sales/contracts';
import { CheckCircle2, Copy, ExternalLink, LogOut, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/errors';

import { useHermesLogin, useHermesLoginAction } from '../api/llm';

const FAILURE_CODES = [
  'device_code_timeout',
  'rate_limited',
  'login_failed',
  'bridge_key_rejected',
];

/** Seconds left until `expiresAt`, ticking once per second; null when unknown. */
function useCountdown(expiresAt: string | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const end = Date.parse(expiresAt);
  return Number.isNaN(end) ? null : Math.max(0, Math.round((end - now) / 1_000));
}

function formatClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function PendingView({
  status,
  busy,
  onRestart,
}: {
  status: HermesLoginStatus;
  busy: boolean;
  onRestart: () => void;
}) {
  const { t } = useTranslation();
  const left = useCountdown(status.expiresAt);
  const code = status.userCode ?? '';
  // Only ever open an https verification page returned by the bridge.
  const link = status.verificationUrl?.startsWith('https://') ? status.verificationUrl : null;

  function copy() {
    void navigator.clipboard
      .writeText(code)
      .then(() => toast.success(t('admin.hermes.copied')))
      .catch(() => undefined);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <output
          aria-label={t('admin.hermes.codeLabel')}
          className="rounded-lg border bg-secondary px-5 py-3 font-mono text-3xl font-semibold tracking-widest text-secondary-foreground"
        >
          {code}
        </output>
        <Button variant="outline" size="icon" onClick={copy} aria-label={t('admin.hermes.copy')}>
          <Copy />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {link ? (
          <Button asChild>
            <a href={link} target="_blank" rel="noopener noreferrer">
              <ExternalLink />
              {t('admin.hermes.openLogin')}
            </a>
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onRestart} disabled={busy}>
          {t('admin.hermes.restart')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground" role="status">
        {t('admin.hermes.pendingHint')}
        {left !== null ? (
          <span className="ml-2 font-mono tabular-nums">
            {left > 0
              ? t('admin.hermes.expiresIn', { time: formatClock(left) })
              : t('admin.hermes.expired')}
          </span>
        ) : null}
      </p>
    </div>
  );
}

/** Lets a platform admin sign the Hermes runtime in to ChatGPT (OAuth device-code flow). */
export function HermesLoginPanel({ providerId }: { providerId: string }) {
  const { t } = useTranslation();
  const status = useHermesLogin(providerId);
  const { start, logout } = useHermesLoginAction(providerId);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const busy = start.isPending || logout.isPending;
  const state = status.data?.state;

  const begin = () =>
    start.mutate(undefined, { onError: (err) => toast.error(errorMessage(t, err)) });

  const signIn = (label: string) => (
    <Button onClick={begin} disabled={busy}>
      {label}
    </Button>
  );

  let body;
  if (status.isPending) body = <Skeleton className="h-16 rounded-lg" />;
  else if (status.isError)
    body = <p className="text-sm text-destructive">{errorMessage(t, status.error)}</p>;
  else if (status.data?.state === 'pending')
    body = <PendingView status={status.data} busy={busy} onRestart={begin} />;
  else if (state === 'disabled')
    body = <p className="text-sm text-muted-foreground">{t('admin.hermes.disabled')}</p>;
  else if (state === 'signed_in')
    body = (
      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-2 font-medium text-success">
          <CheckCircle2 className="size-5" aria-hidden />
          {t('admin.hermes.signedIn')}
        </p>
        <p className="text-sm text-muted-foreground">{t('admin.hermes.signedInHint')}</p>
        <div>
          <Button variant="outline" onClick={() => setConfirmLogout(true)} disabled={busy}>
            <LogOut />
            {t('admin.hermes.logout')}
          </Button>
        </div>
      </div>
    );
  else if (state === 'unreachable')
    body = (
      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-2 font-medium text-destructive">
          <TriangleAlert className="size-5" aria-hidden />
          {t('admin.hermes.unreachable')}
        </p>
        <p className="text-sm text-muted-foreground">{t('admin.hermes.unreachableHint')}</p>
        <div>
          <Button variant="outline" onClick={() => void status.refetch()}>
            {t('admin.hermes.recheck')}
          </Button>
        </div>
      </div>
    );
  else if (state === 'failed') {
    const code = status.data?.code ?? '';
    const key = FAILURE_CODES.includes(code) ? code : 'login_failed';
    body = (
      <div className="flex flex-col gap-3">
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <TriangleAlert className="size-5 shrink-0" aria-hidden />
          {t(`admin.hermes.failures.${key}`)}
        </p>
        <div>{signIn(t('admin.hermes.retry'))}</div>
      </div>
    );
  } else
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t('admin.hermes.signedOutHint')}</p>
        <div>{signIn(t('admin.hermes.login'))}</div>
      </div>
    );

  return (
    <section
      aria-label={t('admin.hermes.title')}
      className="flex flex-col gap-3 rounded-xl border bg-card px-5 py-4 text-card-foreground"
    >
      <h3 className="font-semibold">{t('admin.hermes.title')}</h3>
      {body}
      {state === 'disabled' ? null : (
        <p className="text-xs text-muted-foreground">{t('admin.hermes.terms')}</p>
      )}
      <AlertDialog open={confirmLogout} onOpenChange={setConfirmLogout}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('admin.hermes.logoutConfirm')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('admin.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                logout.mutate(undefined, { onError: (err) => toast.error(errorMessage(t, err)) })
              }
            >
              {t('admin.hermes.logout')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
