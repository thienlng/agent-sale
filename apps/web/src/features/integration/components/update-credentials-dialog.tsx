import type { ConnectionDto } from '@agent-sales/contracts';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { useUpdateKiotViet } from '../api/integrations';
import { type CredentialField, describeFailure, missingCredentials } from '../lib/errors';
import { CredentialsFields, type CredentialValues } from './credentials-fields';

/** New Client ID / secret for the same store, e.g. after the shop rotated its secret. */
export function UpdateCredentialsDialog({
  connection,
  open,
  onOpenChange,
}: {
  connection: ConnectionDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('integration');
  const update = useUpdateKiotViet();
  const blank = (): CredentialValues => ({
    retailer: connection.retailer,
    clientId: '',
    clientSecret: '',
  });
  const [values, setValues] = useState<CredentialValues>(blank);
  const [errors, setErrors] = useState<Partial<Record<CredentialField, string>>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Each opening starts blank. Not keyed on the version: a 409 refetch bumps it, and the typed
  // values and the conflict banner must survive that.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setValues(blank());
      setErrors({});
      setBanner(null);
    }
  }

  const close = (next: boolean) => onOpenChange(next);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (update.isPending) return;
    const missing = missingCredentials(t, values);
    setBanner(null);
    if (Object.keys(missing).length) {
      setErrors(missing);
      setAttempt((n) => n + 1);
      return;
    }
    try {
      await update.mutateAsync({ credentials: values, version: connection.version });
      toast.success(t('connection.credentialsUpdated'));
      close(false);
    } catch (error) {
      const failure = describeFailure(t, error);
      setErrors(failure.fields);
      setBanner(failure.conflict ? t('connection.conflict') : failure.banner);
      setAttempt((n) => n + 1);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{t('connection.updateCredentials')}</DialogTitle>
            <DialogDescription>{t('connection.updateCredentialsHelp')}</DialogDescription>
          </DialogHeader>
          {banner ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{banner}</AlertDescription>
            </Alert>
          ) : null}
          <CredentialsFields
            values={values}
            errors={errors}
            attempt={attempt}
            disabled={update.isPending}
            onChange={(field, value) => {
              setValues((v) => ({ ...v, [field]: value }));
              setErrors((current) => {
                const next = { ...current };
                delete next[field];
                return next;
              });
            }}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" className="h-11" onClick={() => close(false)}>
              {t('connection.cancel')}
            </Button>
            <Button type="submit" className="h-11" disabled={update.isPending}>
              {update.isPending ? (
                <LoaderCircle aria-hidden className="motion-safe:animate-spin" />
              ) : null}
              {t('connection.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
