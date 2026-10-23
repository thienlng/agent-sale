import { Industry } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiClientError } from '@/lib/api-client';
import { signup } from '@/lib/session';

import { FormError } from './form-error';

export function SignupForm({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useTranslation();
  const [industry, setIndustry] = useState<Industry>('retail');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get('password'));
    if (password.length < 8) {
      setError(t('auth.errors.weakPassword'));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await signup({
        name: String(form.get('name')),
        email: String(form.get('email')),
        password,
        workspaceName: String(form.get('workspaceName')),
        industry,
      });
      onSuccess();
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : '';
      setError(
        code === 'CONFLICT'
          ? t('auth.errors.emailTaken')
          : code === 'VALIDATION_FAILED'
            ? t('auth.errors.weakPassword')
            : t('auth.errors.generic'),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
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
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="workspaceName">{t('auth.workspaceName')}</Label>
          <Input id="workspaceName" name="workspaceName" required className="h-10" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="industry">{t('auth.industry')}</Label>
          <Select value={industry} onValueChange={(v) => setIndustry(v as Industry)}>
            <SelectTrigger id="industry" className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Industry.options.map((i) => (
                <SelectItem key={i} value={i}>
                  {t(`industries.${i}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
