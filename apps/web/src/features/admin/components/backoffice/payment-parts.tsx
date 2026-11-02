import {
  type AdminPaymentDto,
  BILLING_PERIODS,
  CreatePaymentRequest,
} from '@agent-sales/contracts';
import { Copy } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatVnd } from '@/lib/format';

import { useAdminPlans, useCreatePayment, usePaymentAction } from '../../api/backoffice';
import { toastAdminError } from '../../lib/mutation-error';
import { ReasonDialog } from './reason-dialog';
import { ReasonField } from './reason-field';

/** The VietQR image and the transfer content the customer must type. */
export function PaymentQr({ payment }: { payment: AdminPaymentDto }) {
  const { t } = useTranslation('backoffice');
  return (
    <div className="flex flex-col items-center gap-4">
      {payment.qrUrl ? (
        <img
          src={payment.qrUrl}
          alt={t('payments.qrTitle')}
          className="size-64 rounded-lg border bg-white object-contain p-2"
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t('payments.qrMissing')}</p>
      )}
      <div className="flex flex-col items-center gap-1">
        <span className="text-sm text-muted-foreground">{t('payments.transferContent')}</span>
        <div className="flex items-center gap-2">
          <code className="rounded bg-muted px-2 py-1 font-mono text-lg">{payment.code}</code>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={t('payments.copy')}
            onClick={() =>
              void navigator.clipboard
                ?.writeText(payment.code)
                .then(() => toast.success(t('payments.copied')))
            }
          >
            <Copy />
          </Button>
        </div>
        <span className="text-lg font-semibold tabular-nums">{formatVnd(payment.amountVnd)}</span>
      </div>
    </div>
  );
}

/** Create a VietQR payment request; on success shows the QR to send to the customer. */
export function CreatePaymentDialog({
  accountId,
  open,
  onOpenChange,
}: {
  accountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('backoffice');
  const plans = useAdminPlans();
  const create = useCreatePayment(accountId);
  const [planCode, setPlanCode] = useState('');
  const [period, setPeriod] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [created, setCreated] = useState<AdminPaymentDto | null>(null);

  useEffect(() => {
    if (!open) return;
    setPlanCode('');
    setPeriod('');
    setAmount('');
    setNote('');
    setReason('');
    setCreated(null);
  }, [open]);

  // Latest sellable version of priced plans only.
  const priced = [
    ...new Map(
      (plans.data ?? [])
        .filter((p) => !p.archived && Object.keys(p.priceByPeriod).length > 0)
        .sort((a, b) => a.version - b.version)
        .map((p) => [p.code, p]),
    ).values(),
  ].sort((a, b) => a.sortOrder - b.sortOrder);
  const plan = priced.find((p) => p.code === planCode);
  const periods = BILLING_PERIODS.filter((m) => plan?.priceByPeriod[String(m)]);
  const monthly = plan && period ? plan.priceByPeriod[period] : undefined;
  const parsed = CreatePaymentRequest.safeParse({
    planCode,
    periodMonths: Number(period),
    ...(amount.trim() ? { amountVnd: Number(amount) } : {}),
    note,
    reason,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!parsed.success) return;
    create.mutate(parsed.data, {
      onSuccess: (payment) => {
        toast.success(t('payments.created'));
        setCreated(payment);
      },
      onError: (err) => toastAdminError(t, err),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {created ? (
          <div className="flex flex-col gap-5">
            <DialogHeader>
              <DialogTitle>{t('payments.qrTitle')}</DialogTitle>
            </DialogHeader>
            <PaymentQr payment={created} />
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-5">
            <DialogHeader>
              <DialogTitle>{t('payments.createTitle')}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="pay-plan">{t('payments.plan')}</Label>
                <Select
                  value={planCode}
                  onValueChange={(v) => {
                    setPlanCode(v);
                    setPeriod('');
                  }}
                >
                  <SelectTrigger id="pay-plan" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {priced.map((p) => (
                      <SelectItem key={p.code} value={p.code}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="pay-period">{t('payments.period')}</Label>
                <Select value={period} onValueChange={setPeriod} disabled={!plan}>
                  <SelectTrigger id="pay-period" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {periods.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {t('common.months', { count: m })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pay-amount">{t('payments.amount')}</Label>
              <Input
                id="pay-amount"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.trim())}
              />
              {monthly ? (
                <p className="text-sm text-muted-foreground">
                  {t('payments.amountHint', { amount: formatVnd(monthly * Number(period)) })}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pay-note">{t('payments.note')}</Label>
              <Input
                id="pay-note"
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <ReasonField id="pay-reason" value={reason} onChange={setReason} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={create.isPending || !parsed.success}>
                {t('account.actions.createPayment')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Confirm / cancel buttons of a pending payment, each behind a reason dialog. */
export function PaymentActions({ payment }: { payment: AdminPaymentDto }) {
  const { t } = useTranslation('backoffice');
  const action = usePaymentAction();
  const [mode, setMode] = useState<'confirm' | 'cancel' | 'qr' | null>(null);
  const [bankReference, setBankReference] = useState('');
  if (payment.status !== 'pending') return null;
  const close = () => {
    setMode(null);
    setBankReference('');
  };
  const done = (message: string) => ({
    onSuccess: () => {
      toast.success(message);
      close();
    },
    onError: (err: Error) => toastAdminError(t, err),
  });

  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="ghost" onClick={() => setMode('qr')}>
        QR
      </Button>
      <Button size="sm" onClick={() => setMode('confirm')}>
        {t('payments.confirm')}
      </Button>
      <Button size="sm" variant="outline" onClick={() => setMode('cancel')}>
        {t('payments.cancel')}
      </Button>

      <Dialog open={mode === 'qr'} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('payments.qrTitle')}</DialogTitle>
            <DialogDescription>{payment.accountName}</DialogDescription>
          </DialogHeader>
          <PaymentQr payment={payment} />
        </DialogContent>
      </Dialog>

      <ReasonDialog
        open={mode === 'confirm'}
        onOpenChange={(o) => !o && close()}
        title={t('payments.confirmTitle', { amount: formatVnd(payment.amountVnd) })}
        description={t('payments.confirmHint', { plan: payment.plan.name })}
        confirmLabel={t('payments.confirm')}
        pending={action.isPending}
        onConfirm={(reason) =>
          action.mutate(
            {
              paymentId: payment.id,
              confirm: { bankReference: bankReference.trim() || null, reason },
            },
            done(t('payments.confirmed')),
          )
        }
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="pay-ref">{t('payments.bankReference')}</Label>
          <Input
            id="pay-ref"
            value={bankReference}
            maxLength={100}
            onChange={(e) => setBankReference(e.target.value)}
          />
          <p className="text-sm text-muted-foreground">{t('payments.bankReferenceHint')}</p>
        </div>
      </ReasonDialog>

      <ReasonDialog
        open={mode === 'cancel'}
        onOpenChange={(o) => !o && close()}
        title={t('payments.cancelTitle', { code: payment.code })}
        confirmLabel={t('payments.cancel')}
        destructive
        pending={action.isPending}
        onConfirm={(reason) =>
          action.mutate({ paymentId: payment.id, cancel: { reason } }, done(t('payments.canceled')))
        }
      />
    </div>
  );
}
