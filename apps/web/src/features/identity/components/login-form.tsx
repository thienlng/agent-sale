import { Link } from '@tanstack/react-router';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiClientError } from '@/lib/api-client';
import { login, verifyGoogleSignIn, verifyGoogleSignUp } from '@/lib/session';

import { FormError } from './form-error';
import { GoogleButton } from './google-button';

const GOOGLE_ERRORS = [
  'cancelled',
  'expired',
  'unverified_email',
  'unavailable',
  'account_exists',
  'too_many',
];

/** A Google sign-in that came back to /login: still waiting for the code, or failed with a reason. */
export type GoogleReturn = { step: 'mfa' } | { step: 'verify' } | { step: 'error'; reason: string };

export function LoginForm({
  onSuccess,
  redirect,
  google,
}: {
  onSuccess: () => void;
  /** Same-app path to open after signing in (passed through Google). */
  redirect?: string | undefined;
  google?: GoogleReturn | undefined;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    google?.step === 'error'
      ? t(`auth.googleErrors.${GOOGLE_ERRORS.includes(google.reason) ? google.reason : 'failed'}`)
      : null,
  );
  // Set once the password (or Google) was right but the account wants a second factor.
  const [pending2fa, setPending2fa] = useState<
    { via: 'password'; email: string; password: string } | { via: 'google' } | null
  >(google?.step === 'mfa' ? { via: 'google' } : null);
  const [recovery, setRecovery] = useState(false);
  // A Google sign-up for an address Google does not own waits for the code emailed to it.
  const [verifying, setVerifying] = useState(google?.step === 'verify');

  async function submitVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') ?? '').trim();
    setPending(true);
    setError(null);
    try {
      await verifyGoogleSignUp(code);
      onSuccess();
    } catch (err) {
      const reason = err instanceof ApiClientError ? err.details?.['reason'] : undefined;
      if (reason === 'google_expired' || reason === 'google_account_exists') {
        setVerifying(false);
        setError(t(`auth.googleErrors.${String(reason).replace('google_', '')}`));
        return;
      }
      const status = err instanceof ApiClientError ? err.code : '';
      setError(
        status === 'RATE_LIMITED'
          ? t('auth.errors.tooMany')
          : status === 'VALIDATION_FAILED' || reason === 'code_invalid' || reason === 'code_expired'
            ? t('auth.googleVerify.invalid')
            : t('auth.errors.generic'),
      );
    } finally {
      setPending(false);
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const viaPassword = pending2fa?.via === 'password' ? pending2fa : null;
    const email = viaPassword?.email ?? String(form.get('email'));
    const password = viaPassword?.password ?? String(form.get('password'));
    const code = pending2fa ? String(form.get('code') ?? '').trim() : undefined;
    setPending(true);
    setError(null);
    try {
      if (pending2fa?.via === 'google') await verifyGoogleSignIn(code ?? '');
      else await login({ email, password, ...(code ? { code } : {}) });
      onSuccess();
    } catch (err) {
      const reason = err instanceof ApiClientError ? err.details?.['reason'] : undefined;
      if (reason === 'mfa_required') {
        setPasswordVisible(false);
        setPending2fa({ via: 'password', email, password });
        return;
      }
      if (reason === 'google_expired') {
        setPending2fa(null);
        setRecovery(false);
        setError(t('auth.googleErrors.expired'));
        return;
      }
      const code = err instanceof ApiClientError ? err.code : '';
      setError(
        reason === 'mfa_invalid'
          ? t('auth.mfa.invalid')
          : code === 'UNAUTHENTICATED' || code === 'VALIDATION_FAILED'
            ? t('auth.errors.invalidCredentials')
            : code === 'RATE_LIMITED'
              ? t('auth.errors.tooMany')
              : t('auth.errors.generic'),
      );
    } finally {
      setPending(false);
    }
  }

  if (verifying) {
    return (
      <form onSubmit={submitVerify} className="flex flex-col gap-5" noValidate>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('auth.googleVerify.title')}</h1>
          <p className="mt-1.5 text-muted-foreground">{t('auth.googleVerify.subtitle')}</p>
        </div>
        {error ? <FormError>{error}</FormError> : null}
        <div className="flex flex-col gap-2">
          <Label htmlFor="verify-code">{t('auth.googleVerify.code')}</Label>
          <Input
            id="verify-code"
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            autoFocus
            required
          />
        </div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? t('auth.loggingIn') : t('auth.googleVerify.submit')}
        </Button>
        <button
          type="button"
          className="text-sm text-muted-foreground hover:underline"
          onClick={() => {
            setVerifying(false);
            setError(null);
          }}
        >
          {t('auth.mfa.back')}
        </button>
      </form>
    );
  }

  if (pending2fa) {
    return (
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('auth.mfa.title')}</h1>
          <p className="mt-1.5 text-muted-foreground">
            {recovery ? t('auth.mfa.recoveryHint') : t('auth.mfa.subtitle')}
          </p>
        </div>
        {error ? <FormError>{error}</FormError> : null}
        <div className="flex flex-col gap-2">
          <Label htmlFor="code">
            {recovery ? t('auth.mfa.recoveryLabel') : t('auth.mfa.code')}
          </Label>
          <Input
            id="code"
            name="code"
            autoComplete="one-time-code"
            inputMode={recovery ? 'text' : 'numeric'}
            autoFocus
            required
          />
        </div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? t('auth.loggingIn') : t('auth.mfa.verify')}
        </Button>
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            className="font-medium text-brand-text hover:underline"
            onClick={() => {
              setRecovery((r) => !r);
              setError(null);
            }}
          >
            {recovery ? t('auth.mfa.useApp') : t('auth.mfa.useRecovery')}
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:underline"
            onClick={() => {
              setPending2fa(null);
              setRecovery(false);
              setError(null);
            }}
          >
            {t('auth.mfa.back')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('auth.loginTitle')}</h1>
        <p className="mt-1.5 text-muted-foreground">{t('auth.loginSubtitle')}</p>
      </div>
      {error ? <FormError>{error}</FormError> : null}
      <div className="flex flex-col gap-2">
        <Label className="sr-only" htmlFor="email">
          {t('auth.email')}
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t('auth.email')}
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label className="sr-only" htmlFor="password">
          {t('auth.password')}
        </Label>
        <div className="login-password">
          <Input
            id="password"
            name="password"
            type={passwordVisible ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder={t('auth.password')}
            required
          />
          <button
            type="button"
            className="password-toggle"
            aria-label={t(passwordVisible ? 'auth.hidePassword' : 'auth.showPassword')}
            onClick={() => setPasswordVisible((value) => !value)}
          >
            {passwordVisible ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
          </button>
        </div>
        <Link
          to="/forgot-password"
          className="login-forgot text-sm text-brand-text hover:underline"
        >
          {t('auth.forgotPassword')}
        </Link>
      </div>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? t('auth.loggingIn') : t('auth.login')}
        <ArrowRight size={18} aria-hidden />
      </Button>
      <GoogleButton redirect={redirect} />
      <p className="text-center text-sm text-muted-foreground">
        {t('auth.noAccount')}{' '}
        <Link to="/signup" className="font-medium text-brand-text hover:underline">
          {t('auth.signup')}
        </Link>
      </p>
    </form>
  );
}
