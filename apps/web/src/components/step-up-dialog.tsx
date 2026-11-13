import { CircleAlert } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useStepUp, useStepUpStatus } from '@/hooks/use-step-up';
import { ApiClientError, setStepUpHandler, type StepUpReason } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { googleSignInUrl } from '@/lib/session';

const KNOWN_ERRORS = ['invalid_password', 'invalid_code', 'code_invalid', 'code_expired'];

/** A sentence for a refused step-up (wrong password or code, expired code, throttled). */
function stepUpError(t: ReturnType<typeof useTranslation>['t'], error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'RATE_LIMITED' || error.status === 429) return t('stepUp.errors.too_many');
    const reason = error.details?.['reason'];
    if (typeof reason === 'string' && KNOWN_ERRORS.includes(reason)) {
      return t(`stepUp.errors.${reason}`);
    }
  }
  return errorMessage(t, error);
}

/**
 * "Confirm it's you" (docs/09 §2): one proof, as the server asks for it — a two-factor code when
 * two-factor is on, else the password, else a code emailed to the address (Google sign-in only,
 * who may also sign in with Google again, except for `step_up_required`: a new Google sign-in
 * opens another session and is not an explicit step-up). `onDone(true)` once the session passed it.
 */
export function StepUpDialog({
  open,
  reason = 'reauth_required',
  onDone,
}: {
  open: boolean;
  reason?: StepUpReason | undefined;
  onDone: (confirmed: boolean) => void;
}) {
  const { t } = useTranslation();
  const status = useStepUpStatus(open);
  const { verify, sendCode } = useStepUp();
  const [value, setValue] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setValue('');
      setSent(false);
      setError(null);
    }
  }

  const methods = status.data?.methods ?? [];
  const method = methods[0];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!method || verify.isPending) return;
    setError(null);
    try {
      await verify.mutateAsync(
        method === 'totp'
          ? { code: value.trim() }
          : method === 'password'
            ? { password: value }
            : { emailCode: value.trim() },
      );
      onDone(true);
    } catch (err) {
      setError(stepUpError(t, err));
    }
  }

  async function send() {
    setError(null);
    try {
      await sendCode.mutateAsync();
      setSent(true);
    } catch (err) {
      setError(stepUpError(t, err));
    }
  }

  const label =
    method === 'totp'
      ? t('stepUp.code')
      : method === 'password'
        ? t('stepUp.password')
        : t('stepUp.emailCode');
  const here = `${window.location.pathname}${window.location.search}`;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onDone(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('stepUp.title')}</DialogTitle>
          <DialogDescription>
            {reason === 'mfa_session_required'
              ? t('stepUp.adminHint')
              : reason === 'step_up_required'
                ? t('stepUp.explicitHint')
                : t('stepUp.hint')}
          </DialogDescription>
        </DialogHeader>
        {status.isPending ? (
          <Skeleton className="h-20" />
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            {error ? (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-lg bg-destructive-soft px-3 py-2.5 text-sm text-destructive"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {error}
              </p>
            ) : null}
            {method === 'email' ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={sendCode.isPending}
                  onClick={() => void send()}
                >
                  {sent ? t('stepUp.resend') : t('stepUp.sendCode')}
                </Button>
                {sent ? <span className="text-muted-foreground">{t('stepUp.sent')}</span> : null}
              </div>
            ) : null}
            {method ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="step-up-value">{label}</Label>
                <Input
                  id="step-up-value"
                  type={method === 'password' ? 'password' : 'text'}
                  autoComplete={method === 'password' ? 'current-password' : 'one-time-code'}
                  inputMode={method === 'password' ? undefined : 'numeric'}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  autoFocus
                  required
                />
              </div>
            ) : null}
            {methods.includes('google') && reason !== 'step_up_required' ? (
              <a
                href={googleSignInUrl(here)}
                className="text-sm font-medium text-brand-text hover:underline"
              >
                {t('stepUp.google')}
              </a>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onDone(false)}>
                {t('stepUp.cancel')}
              </Button>
              <Button type="submit" disabled={!method || !value || verify.isPending}>
                {t('stepUp.confirm')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Mounted once at the root: answers the API client's step-up requests with the dialog, so any
 * sensitive action (API key, data export, back office write…) prompts and then goes through.
 */
export function StepUpHost() {
  const [request, setRequest] = useState<{
    reason: StepUpReason;
    resolve: (confirmed: boolean) => void;
  } | null>(null);

  useEffect(() => {
    setStepUpHandler((reason) => new Promise((resolve) => setRequest({ reason, resolve })));
    return () => setStepUpHandler(null);
  }, []);

  return (
    <StepUpDialog
      open={request !== null}
      reason={request?.reason}
      onDone={(confirmed) => {
        request?.resolve(confirmed);
        setRequest(null);
      }}
    />
  );
}
