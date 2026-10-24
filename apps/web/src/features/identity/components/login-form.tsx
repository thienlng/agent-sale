import { Link } from '@tanstack/react-router';
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
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      await login({ email: String(form.get('email')), password: String(form.get('password')) });
      onSuccess();
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : '';
      setError(
        code === 'UNAUTHENTICATED' || code === 'VALIDATION_FAILED'
          ? t('auth.errors.invalidCredentials')
          : code === 'RATE_LIMITED'
            ? t('auth.errors.tooMany')
            : t('auth.errors.generic'),
      );
    } finally {
      setPending(false);
    }
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
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="h-10"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t('auth.password')}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-10"
        />
      </div>
      <Button type="submit" size="lg" className="h-10" disabled={pending}>
        {pending ? t('auth.loggingIn') : t('auth.login')}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {t('auth.noAccount')}{' '}
        <Link to="/signup" className="font-medium text-primary hover:underline">
          {t('auth.signup')}
        </Link>
      </p>
    </form>
  );
}
