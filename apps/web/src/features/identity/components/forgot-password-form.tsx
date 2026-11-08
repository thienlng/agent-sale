import { ForgotPasswordRequest, ResetPasswordRequest } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiClientError } from '@/lib/api-client';

import { FormError } from './form-error';

/** Forgotten password: the email, then the emailed code and a new password. */
export function ForgotPasswordForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function failure(err: unknown): string {
    if (!(err instanceof ApiClientError)) return t('auth.errors.generic');
    const reason = err.details?.['reason'];
    if (reason === 'code_invalid') return t('auth.verify.invalid');
    if (reason === 'code_expired') return t('auth.verify.expired');
    if (err.code === 'RATE_LIMITED') return t('auth.errors.tooMany');
    if (err.code === 'VALIDATION_FAILED') return t('auth.errors.weakPassword');
    return t('auth.errors.generic');
  }

  async function sendCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = ForgotPasswordRequest.safeParse({
      email: String(new FormData(e.currentTarget).get('email') ?? ''),
    });
    if (!parsed.success) {
      setError(t('auth.errors.invalidCredentials'));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api('/auth/password/forgot', z.null(), {
        method: 'POST',
        body: parsed.data,
        workspaceScoped: false,
      });
      setEmail(parsed.data.email);
    } catch (err) {
      setError(failure(err));
    } finally {
      setPending(false);
    }
  }

  async function reset(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get('password') ?? '');
    if (password.length < 8) {
      setError(t('auth.errors.weakPassword'));
      return;
    }
    const parsed = ResetPasswordRequest.safeParse({
      email,
      code: String(form.get('code') ?? '').replace(/\s/g, ''),
      password,
    });
    if (!parsed.success) {
      setError(t('auth.verify.invalid'));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api('/auth/password/reset', z.null(), {
        method: 'POST',
        body: parsed.data,
        workspaceScoped: false,
      });
      onDone();
    } catch (err) {
      setError(failure(err));
    } finally {
      setPending(false);
    }
  }

  const back = (
    <p className="text-center text-sm text-muted-foreground">
      <Link to="/login" className="font-medium text-brand-text hover:underline">
        {t('auth.reset.back')}
      </Link>
    </p>
  );

  if (email) {
    return (
      <form onSubmit={(e) => void reset(e)} className="flex flex-col gap-5" noValidate>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('auth.reset.title')}</h1>
          <p className="mt-1.5 text-muted-foreground">{t('auth.reset.codeSubtitle', { email })}</p>
        </div>
        {error ? <FormError>{error}</FormError> : null}
        <div className="flex flex-col gap-2">
          <Label htmlFor="code">{t('auth.reset.code')}</Label>
          <Input
            id="code"
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            autoFocus
            required
            className="tracking-[0.4em]"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">{t('auth.reset.newPassword')}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            aria-describedby="password-hint"
          />
          <p id="password-hint" className="text-sm text-muted-foreground">
            {t('auth.passwordHint')}
          </p>
        </div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? t('auth.reset.submitting') : t('auth.reset.submit')}
        </Button>
        {back}
      </form>
    );
  }

  return (
    <form onSubmit={(e) => void sendCode(e)} className="flex flex-col gap-5" noValidate>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('auth.reset.title')}</h1>
        <p className="mt-1.5 text-muted-foreground">{t('auth.reset.subtitle')}</p>
      </div>
      {error ? <FormError>{error}</FormError> : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t('auth.email')}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" autoFocus required />
      </div>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? t('auth.reset.sending') : t('auth.reset.send')}
      </Button>
      {back}
    </form>
  );
}
