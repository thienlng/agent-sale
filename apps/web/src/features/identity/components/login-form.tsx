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
        <Label htmlFor="email">{t('auth.email')}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">{t('auth.password')}</Label>
          <Link to="/forgot-password" className="text-sm text-brand-text hover:underline">
            {t('auth.forgotPassword')}
          </Link>
        </div>
        <div className="login-password">
          <Input
            id="password"
            name="password"
            type={passwordVisible ? 'text' : 'password'}
            autoComplete="current-password"
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
      </div>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? t('auth.loggingIn') : t('auth.login')}
        <ArrowRight size={18} aria-hidden />
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {t('auth.noAccount')}{' '}
        <Link to="/signup" className="font-medium text-brand-text hover:underline">
          {t('auth.signup')}
        </Link>
      </p>
    </form>
  );
}
