import { PAYMENT_STATUSES } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime, formatVnd } from '@/lib/format';

import { useAdminPayments } from '../../api/backoffice';
import { PageHeader } from './page-header';
import { PaymentActions } from './payment-parts';
import { PaymentStatusBadge } from './status-badges';

const ALL = '__all';
type Status = (typeof PAYMENT_STATUSES)[number];

/** VietQR payment requests across accounts; pending ones are confirmed by hand (ADR-021 §6). */
export function PaymentsPage() {
  const { t } = useTranslation('backoffice');
  const [status, setStatus] = useState<Status | undefined>('pending');
  const payments = useAdminPayments(status ? { status } : {});
  const rows = payments.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title={t('payments.title')} subtitle={t('payments.subtitle')} />
      <Select
        value={status ?? ALL}
        onValueChange={(v) => setStatus(v === ALL ? undefined : (v as Status))}
      >
        <SelectTrigger aria-label={t('payments.status')} className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t('common.all')}</SelectItem>
          {PAYMENT_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`paymentStatus.${s}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {payments.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : payments.isError ? (
        <p className="text-sm text-destructive">{t('common.loadError')}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t('payments.empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('payments.code')}</TableHead>
                <TableHead>{t('payments.account')}</TableHead>
                <TableHead>{t('payments.plan')}</TableHead>
                <TableHead className="text-right">{t('payments.amount')}</TableHead>
                <TableHead>{t('payments.status')}</TableHead>
                <TableHead>{t('payments.createdAt')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono">{p.code}</TableCell>
                  <TableCell className="max-w-56">
                    <Link
                      to="/admin/accounts/$accountId"
                      params={{ accountId: p.accountId }}
                      className="block truncate hover:underline"
                    >
                      {p.accountName}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {p.plan.name} · {t('common.months', { count: p.periodMonths })}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatVnd(p.amountVnd)}
                  </TableCell>
                  <TableCell>
                    <PaymentStatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatDateTime(p.createdAt)}
                  </TableCell>
                  <TableCell>
                    <PaymentActions payment={p} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {payments.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={payments.isFetchingNextPage}
            onClick={() => void payments.fetchNextPage()}
          >
            {t('common.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
