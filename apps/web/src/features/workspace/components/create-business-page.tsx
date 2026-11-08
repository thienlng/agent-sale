import { type Industry, SELECTABLE_INDUSTRIES } from '@agent-sales/contracts';
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
import { useBusinessSwitch } from '@/hooks/use-business-switch';
import { ApiClientError } from '@/lib/api-client';
import { useAssistantContext, useAssistantForm } from '@/lib/assistant-context';
import { createFirstBusiness, reloadSession, useSession } from '@/lib/session';

import { useCreateBusiness } from '../api/create-business';

const NAME_MAX = 120;
/**
 * The industries a new business may pick (the verified ones, `SELECTABLE_INDUSTRIES`): the select
 * and the assistant's form share it (T175-R11).
 */
const INDUSTRY_OPTIONS: readonly Industry[] = SELECTABLE_INDUSTRIES;

/**
 * Account-level form: a new business is created, then opened in its own management area. It goes
 * under the account the user owns; with several owned accounts the user picks one (ADR-012 §3).
 * A user without any business sees it as the welcome step (T-079). A user who owns no account yet
 * (just signed up, or only a member elsewhere) creates the first one through the signup step,
 * which also starts the trial.
 */
export function CreateBusinessPage() {
  const { t } = useTranslation();
  const session = useSession();
  const create = useCreateBusiness();
  const { busy, choose } = useBusinessSwitch();
  const owned = session?.accounts.filter((a) => a.role === 'owner') ?? [];
  const first = session?.memberships.length === 0;
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState<Industry>('retail');
  const [accountId, setAccountId] = useState(owned[0]?.accountId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [firstPending, setFirstPending] = useState(false);
  const pending = create.isPending || firstPending;

  useAssistantContext({ title: t('business.create.title') });
  // The owner assistant may draft the name and pick the industry, never the account (T175-R6).
  useAssistantForm(
    'business',
    () => [
      {
        name: 'name',
        label: t('business.create.name'),
        type: 'text',
        empty: !name.trim(),
        value: name,
      },
      {
        name: 'industry',
        label: t('auth.industry'),
        type: 'select',
        options: [...INDUSTRY_OPTIONS],
        empty: false,
      },
    ],
    (values) => {
      if (typeof values['name'] === 'string') setName(values['name'].slice(0, NAME_MAX));
      const picked = INDUSTRY_OPTIONS.find((i) => i === values['industry']);
      if (picked) setIndustry(picked);
    },
    { submitTarget: 'business.create' },
  );

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    try {
      let id: string;
      if (owned.length === 0) {
        setFirstPending(true);
        id = await createFirstBusiness({ workspaceName: trimmed, industry });
      } else {
        id = (
          await create.mutateAsync({
            name: trimmed,
            industry,
            ...(owned.length > 1 && accountId ? { accountId } : {}),
          })
        ).id;
      }
      await reloadSession();
      await choose(id);
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : '';
      setError(
        code === 'FORBIDDEN' || code === 'QUOTA_EXCEEDED' || code === 'FEATURE_LOCKED'
          ? t('business.create.denied')
          : t('business.create.error'),
      );
    } finally {
      setFirstPending(false);
    }
  }

  return (
    <section className="flex max-w-lg flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {first ? t('business.welcomeTitle') : t('business.create.title')}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {first ? t('business.welcomeSubtitle') : t('business.create.subtitle')}
        </p>
      </div>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="business-name">{t('business.create.name')}</Label>
          <Input
            id="business-name"
            name="name"
            required
            maxLength={NAME_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="business-industry">{t('auth.industry')}</Label>
          <Select value={industry} onValueChange={(v) => setIndustry(v as Industry)}>
            <SelectTrigger id="business-industry" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INDUSTRY_OPTIONS.map((i) => (
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
              <SelectTrigger id="business-account" className="w-full">
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
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          data-assistant-target="business.create"
          disabled={pending || busy}
          className="self-start"
        >
          {pending ? t('business.create.creating') : t('business.create.submit')}
        </Button>
      </form>
    </section>
  );
}
