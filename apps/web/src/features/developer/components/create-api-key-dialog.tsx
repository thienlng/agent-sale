import { API_KEY_SCOPES, type ApiKeyScope } from '@agent-sales/contracts';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/errors';

import { useCreateApiKey } from '../api/developer';

/** End of the picked local day, as the ISO instant the server stores; null when no date. */
export function expiryFromDate(date: string): string | null {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1, 23, 59, 59).toISOString();
}

/** Name, scopes and an optional expiry; hands the full key (shown once) to `onCreated`. */
export function CreateApiKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (key: string) => void;
}) {
  const { t } = useTranslation('developer');
  const { t: tc } = useTranslation();
  const create = useCreateApiKey();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>([]);
  const [expires, setExpires] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName('');
      setScopes([]);
      setExpires('');
      setError(null);
    }
  }

  const toggle = (scope: ApiKeyScope, on: boolean) =>
    setScopes((current) =>
      on
        ? API_KEY_SCOPES.filter((s) => s === scope || current.includes(s))
        : current.filter((s) => s !== scope),
    );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (create.isPending) return;
    const expiresAt = expiryFromDate(expires);
    if (!name.trim()) return setError(t('keys.form.nameRequired'));
    if (!scopes.length) return setError(t('keys.form.scopesRequired'));
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now())
      return setError(t('keys.form.expiryPast'));
    setError(null);
    try {
      const created = await create.mutateAsync({ name: name.trim(), scopes, expiresAt });
      onOpenChange(false);
      onCreated(created.key);
    } catch (err) {
      setError(errorMessage(tc, err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{t('keys.form.title')}</DialogTitle>
            <DialogDescription>{t('keys.form.description')}</DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="api-key-name">{t('keys.form.name')}</Label>
            <Input
              id="api-key-name"
              value={name}
              maxLength={80}
              placeholder={t('keys.form.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{t('keys.scopes')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {API_KEY_SCOPES.map((scope) => (
                <Label key={scope} className="flex items-center gap-2 font-normal">
                  <Checkbox
                    checked={scopes.includes(scope)}
                    onCheckedChange={(on) => toggle(scope, on === true)}
                  />
                  {t(`scopes.${scope}`)}
                </Label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-2">
            <Label htmlFor="api-key-expiry">{t('keys.form.expiresAt')}</Label>
            <Input
              id="api-key-expiry"
              type="date"
              className="w-48"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? (
                <LoaderCircle aria-hidden className="motion-safe:animate-spin" />
              ) : null}
              {t('keys.form.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
