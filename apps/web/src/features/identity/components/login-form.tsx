import { Link } from '@tanstack/react-router';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiClientError } from '@/lib/api-client';
import { login } from '@/lib/session';

import { FormError } from './form-error';

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the password was right but the account wants a second factor.
  const [pending2fa, setPending2fa] = useState<{ email: string; password: string } | null>(null);
  const [recovery, setRecovery] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = pending2fa?.email ?? String(form.get('email'));
    const password = pending2fa?.password ?? String(form.get('password'));
    const code = pending2fa ? String(form.get('code') ?? '').trim() : undefined;
    setPending(true);
    setError(null);
    try {
      await login({ email, password, ...(code ? { code } : {}) });
      onSuccess();
    } catch (err) {
      const reason = err instanceof ApiClientError ? err.details?.['reason'] : undefined;
      if (reason === 'mfa_required') {
        setPasswordVisible(false);
        setPending2fa({ email, password });
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
      <button type="button" className="login-google" disabled>
        <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z"
          />
          <path
            fill="#34A853"
            d="M24 44c5.5 0 10.1-1.8 13.5-4.5l-6.6-5.1c-1.8 1.2-4.1 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20.4 20.4 0 0 0 24 44Z"
          />
          <path fill="#FBBC05" d="M12.6 27.9a12.2 12.2 0 0 1 0-7.8v-5.3H5.8a20 20 0 0 0 0 18.4Z" />
          <path
            fill="#EA4335"
            d="M24 11.7c3 0 5.7 1 7.8 3.1l5.8-5.8A19.4 19.4 0 0 0 24 4 20.4 20.4 0 0 0 5.8 14.8l6.8 5.3c1.6-4.8 6.1-8.4 11.4-8.4Z"
          />
        </svg>
        {t('auth.googleLogin')}
        <small>{t('auth.googleSoon')}</small>
      </button>
      <p className="text-center text-sm text-muted-foreground">
        {t('auth.noAccount')}{' '}
        <Link to="/signup" className="font-medium text-brand-text hover:underline">
          {t('auth.signup')}
        </Link>
      </p>
    </form>
  );
}
