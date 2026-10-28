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
import { useBusinessSwitch } from '@/hooks/use-business-switch';
import { ApiClientError } from '@/lib/api-client';

import { useCreateBusiness } from '../api/create-business';

/** Account-level form: a new business is created, then opened in its own management area. */
export function CreateBusinessPage() {
  const { t } = useTranslation();
  const create = useCreateBusiness();
  const { busy, choose } = useBusinessSwitch();
  const [industry, setIndustry] = useState<Industry>('retail');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name')).trim();
    if (!name) return;
    setError(null);
    try {
      const created = await create.mutateAsync({ name, industry });
      await choose(created.id);
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : '';
      setError(
        code === 'FORBIDDEN' || code === 'QUOTA_EXCEEDED' || code === 'FEATURE_LOCKED'
          ? t('business.create.denied')
          : t('business.create.error'),
      );
    }
  }

  return (
    <section className="flex max-w-lg flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('business.create.title')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('business.create.subtitle')}</p>
      </div>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="business-name">{t('business.create.name')}</Label>
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
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={create.isPending || busy} className="self-start">
          {create.isPending ? t('business.create.creating') : t('business.create.submit')}
        </Button>
      </form>
    </section>
  );
}
