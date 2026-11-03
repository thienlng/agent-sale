import { Link } from '@tanstack/react-router';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiClientError } from '@/lib/api-client';
import { requestSignupCode, signup } from '@/lib/session';

import { FormError } from './form-error';

/** The server lets a new code go out once a minute. */
const RESEND_SECONDS = 60;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * One page (ACC-01): name, email with "Send code", the emailed 6-digit code, password. The account
 * is created only with a valid code; the business comes later (onboarding).
 * `defaultEmail`: prefilled when the visitor came from an invitation link.
 */
export function SignupForm({
  onSuccess,
  defaultEmail,
}: {
  onSuccess: () => void;
  defaultEmail?: string | undefined;
}) {
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The address the latest code went to; changing the email asks for a new code. */
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  function field(name: string): string {
    const form = formRef.current;
    return form ? String(new FormData(form).get(name) ?? '').trim() : '';
  }

  async function sendCode() {
    const email = field('email').toLowerCase();
    setError(null);
    setNotice(null);
    if (!EMAIL.test(email)) {
      setError(t('auth.errors.invalidEmail'));
      return;
    }
    setSending(true);
    try {
      await requestSignupCode(email, field('name') || undefined);
      setNotice(t(sentTo === email ? 'auth.verify.resent' : 'auth.verify.sent', { email }));
      setSentTo(email);
      setWait(RESEND_SECONDS);
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : '';
      const seconds =
        err instanceof ApiClientError ? Number(err.details?.['retryAfterSeconds'] ?? 0) : 0;
      if (code === 'CONFLICT') setError(t('auth.errors.emailTaken'));
      else if (seconds > 0) {
        setWait(seconds);
        setError(t('auth.errors.tooManyCodes', { seconds }));
      } else setError(t('auth.errors.generic'));
    } finally {
      setSending(false);
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email')).trim().toLowerCase();
    const code = String(form.get('code') ?? '').replace(/\s/g, '');
    const password = String(form.get('password'));
    if (sentTo !== email || !/^\d{6}$/.test(code)) {
      setError(t(sentTo === email ? 'auth.verify.invalid' : 'auth.verify.needCode'));
      return;
    }
    if (password.length < 8) {
      setError(t('auth.errors.weakPassword'));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await signup({ name: String(form.get('name')), email, password, code });
      onSuccess();
    } catch (err) {
      const apiCode = err instanceof ApiClientError ? err.code : '';
      const reason = err instanceof ApiClientError ? err.details?.['reason'] : undefined;
      setError(
        reason === 'code_invalid'
          ? t('auth.verify.invalid')
          : reason === 'code_expired'
            ? t('auth.verify.expired')
            : apiCode === 'CONFLICT'
              ? t('auth.errors.emailTaken')
              : apiCode === 'VALIDATION_FAILED'
                ? t('auth.errors.weakPassword')
                : t('auth.errors.generic'),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={(e) => void submit(e)} className="flex flex-col gap-5" noValidate>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('auth.signupTitle')}</h1>
        <p className="mt-1.5 text-muted-foreground">{t('auth.signupSubtitle')}</p>
      </div>
      {error ? <FormError>{error}</FormError> : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">{t('auth.name')}</Label>
        <Input id="name" name="name" autoComplete="name" required className="h-10" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t('auth.email')}</Label>
        <div className="flex gap-2">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={defaultEmail}
            className="h-10"
          />
          <Button
            type="button"
            variant="outline"
            className="h-10 shrink-0"
            disabled={sending || wait > 0}
            onClick={() => void sendCode()}
          >
            {sending
              ? t('auth.verify.sending')
              : wait > 0
                ? t('auth.verify.resendIn', { seconds: wait })
                : sentTo
                  ? t('auth.verify.resend')
                  : t('auth.verify.send')}
          </Button>
        </div>
        {notice ? (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="code">{t('auth.verify.code')}</Label>
        <Input
          id="code"
          name="code"
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          required
          aria-describedby="code-hint"
          className="h-10 tracking-[0.4em]"
        />
        <p id="code-hint" className="text-sm text-muted-foreground">
          {t('auth.verify.spamHint')}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t('auth.password')}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          aria-describedby="password-hint"
          className="h-10"
        />
        <p id="password-hint" className="text-sm text-muted-foreground">
          {t('auth.passwordHint')}
        </p>
      </div>
      <Button type="submit" size="lg" className="h-10" disabled={pending}>
        {pending ? t('auth.signingUp') : t('auth.signup')}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {t('auth.haveAccount')}{' '}
        <Link to="/login" className="font-medium text-primary hover:underline">
          {t('auth.login')}
        </Link>
      </p>
    </form>
  );
}
