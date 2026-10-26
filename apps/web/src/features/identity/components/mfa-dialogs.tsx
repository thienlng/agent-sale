import QRCode from 'qrcode';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
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
import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';

import { useMfaMutations } from '../api/mfa';
import { FormError } from './form-error';
import { RecoveryCodes } from './recovery-codes';

function reasonMessage(t: ReturnType<typeof useTranslation>['t'], e: unknown): string {
  const reason = e instanceof ApiClientError ? e.details?.['reason'] : undefined;
  return typeof reason === 'string' && e instanceof ApiClientError && e.code !== 'RATE_LIMITED'
    ? t(`wsettings.security.errors.${reason}`, { defaultValue: errorMessage(t, e) })
    : errorMessage(t, e);
}

/** Password → QR → first code → recovery codes. Closing before the last step abandons the setup. */
export function EnableMfaDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const m = useMfaMutations();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setup = m.setup.data;
  const qr = useQuery({
    queryKey: ['mfa-qr', setup?.otpauthUri],
    queryFn: () => QRCode.toDataURL(setup?.otpauthUri ?? '', { margin: 1, width: 192 }),
    enabled: Boolean(setup),
    staleTime: Infinity,
  });

  function close() {
    setPassword('');
    setCode('');
    setCodes(null);
    setError(null);
    m.setup.reset();
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (!setup) await m.setup.mutateAsync(password);
      else {
        setCodes((await m.enable.mutateAsync(code)).recoveryCodes);
        toast.success(t('wsettings.security.enabledToast'));
      }
    } catch (err) {
      setError(reasonMessage(t, err));
    }
  }

  const pending = m.setup.isPending || m.enable.isPending;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !codes && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {codes ? t('wsettings.security.codesTitle') : t('wsettings.security.enable')}
          </DialogTitle>
          <DialogDescription className="sr-only">{t('wsettings.security.hint')}</DialogDescription>
        </DialogHeader>
        {codes ? (
          <RecoveryCodes codes={codes} onDone={close} />
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            {error ? <FormError>{error}</FormError> : null}
            {!setup ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="mfa-password">{t('wsettings.security.step1')}</Label>
                <Input
                  id="mfa-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('wsettings.security.password')}
                  required
                />
              </div>
            ) : (
              <>
                <p className="text-sm font-medium">{t('wsettings.security.step2')}</p>
                {qr.data ? (
                  <img
                    src={qr.data}
                    alt={t('wsettings.security.qrAlt')}
                    width={192}
                    height={192}
                    className="self-center rounded-md border bg-white"
                  />
                ) : null}
                <p className="text-sm text-muted-foreground">
                  {t('wsettings.security.manual')}{' '}
                  <code className="break-all font-mono text-foreground">{setup.secret}</code>
                </p>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="mfa-code">{t('wsettings.security.step3')}</Label>
                  <Input
                    id="mfa-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    required
                  />
                </div>
              </>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                {t('wsettings.security.cancel')}
              </Button>
              <Button type="submit" disabled={pending || (setup ? code.length !== 6 : !password)}>
                {setup ? t('wsettings.security.confirm') : t('wsettings.security.continue')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Password + a current code, for the two actions that weaken or replace the second factor. */
export function ReauthMfaDialog({
  mode,
  onClose,
}: {
  mode: 'disable' | 'regenerate' | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const m = useMfaMutations();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setPassword('');
    setCode('');
    setCodes(null);
    setError(null);
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (mode === 'disable') {
        await m.disable.mutateAsync({ password, code });
        toast.success(t('wsettings.security.disabledToast'));
        close();
      } else {
        setCodes((await m.regenerate.mutateAsync({ password, code })).recoveryCodes);
      }
    } catch (err) {
      setError(reasonMessage(t, err));
    }
  }

  const disabling = mode === 'disable';
  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && !codes && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {codes
              ? t('wsettings.security.codesTitle')
              : disabling
                ? t('wsettings.security.disableTitle')
                : t('wsettings.security.newCodesTitle')}
          </DialogTitle>
          <DialogDescription>
            {disabling ? t('wsettings.security.disableHint') : t('wsettings.security.newCodesHint')}
          </DialogDescription>
        </DialogHeader>
        {codes ? (
          <RecoveryCodes codes={codes} onDone={close} />
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            {error ? <FormError>{error}</FormError> : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor="re-password">{t('wsettings.security.password')}</Label>
              <Input
                id="re-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="re-code">{t('wsettings.security.codeOrRecovery')}</Label>
              <Input
                id="re-code"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                {t('wsettings.security.cancel')}
              </Button>
              <Button
                type="submit"
                variant={disabling ? 'destructive' : 'default'}
                disabled={m.disable.isPending || m.regenerate.isPending || !password || !code}
              >
                {t('wsettings.security.confirm')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
