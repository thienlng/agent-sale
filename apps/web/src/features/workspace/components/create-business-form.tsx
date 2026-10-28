import { Industry } from '@agent-sales/contracts';
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
import type { Session } from '@/lib/session';

import { useCreateBusiness } from '../api/businesses';

/**
 * Creates a business under an account the user owns. With one owned account (or none: the
 * server then opens one) the account is implicit; with several the user picks it.
 */
export function CreateBusinessForm({
  session,
  onCreated,
  onCancel,
}: {
  session: Session;
  onCreated: (workspaceId: string) => void | Promise<void>;
  /** Omitted when there is nowhere to go back to (no business yet). */
  onCancel?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const owned = session.accounts.filter((a) => a.role === 'owner');
  const [industry, setIndustry] = useState<Industry>('retail');
  const [accountId, setAccountId] = useState(owned[0]?.accountId ?? '');
  const [error, setError] = useState(false);
  const create = useCreateBusiness();
  const first = session.memberships.length === 0;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name')).trim();
    if (!name) return;
    setError(false);
    try {
      const created = await create.mutateAsync({
        name,
        industry,
        ...(owned.length > 1 && accountId ? { accountId } : {}),
      });
      await onCreated(created.id);
    } catch {
      setError(true);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {first ? t('business.welcomeTitle') : t('business.createTitle')}
        </h1>
        <p className="mt-1.5 text-muted-foreground">
          {first ? t('business.welcomeSubtitle') : t('business.createSubtitle')}
        </p>
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-destructive-soft px-3 py-2.5 text-sm text-destructive"
        >
          {t('business.createError')}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="business-name">{t('business.name')}</Label>
        <Input id="business-name" name="name" required maxLength={120} className="h-10" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="business-industry">{t('auth.industry')}</Label>
        <Select value={industry} onValueChange={(v) => setIndustry(v as Industry)}>
          <SelectTrigger id="business-industry" className="h-10 w-full">
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
      {owned.length > 1 ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="business-account">{t('business.accountLabel')}</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger id="business-account" className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {owned.map((a) => (
                <SelectItem key={a.accountId} value={a.accountId}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <Button type="submit" size="lg" className="h-10" disabled={create.isPending}>
        {create.isPending ? t('business.creating') : t('business.create')}
      </Button>
      {onCancel ? (
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('business.back')}
        </Button>
      ) : null}
    </form>
  );
}
