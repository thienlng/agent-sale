import type { AdminAccountDetail } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime, formatNumber, formatVnd } from '@/lib/format';

import { PaymentActions } from './payment-parts';
import { PaymentStatusBadge } from './status-badges';

/** Read-only cards on the account page. */
export function BusinessesCard({ account }: { account: AdminAccountDetail }) {
  const { t } = useTranslation('backoffice');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.businesses')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col divide-y">
          {account.businesses.map((b) => (
            <li key={b.id} className="flex justify-between gap-2 py-2">
              <span className="font-medium">{b.name}</span>
              <span className="text-sm text-muted-foreground">
                {b.industry} · {formatNumber(b.memberCount)} {t('account.members')}
              </span>
            </li>
          ))}
        </ul>
        {account.accountMembers.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">{t('account.accountMembers')}</p>
            <ul className="text-sm text-muted-foreground">
              {account.accountMembers.map((m) => (
                <li key={m.id}>
                  {m.name} · {m.email} · {m.role}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function PaymentsCard({ account }: { account: AdminAccountDetail }) {
  const { t } = useTranslation('backoffice');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.payments')}</CardTitle>
      </CardHeader>
      <CardContent>
        {account.payments.length === 0 ? (
          <p className="text-muted-foreground">{t('account.noPayments')}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {account.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {p.plan.name} · {t('common.months', { count: p.periodMonths })} ·{' '}
                    {formatVnd(p.amountVnd)}
                  </p>
                  <p className="font-mono text-sm text-muted-foreground">
                    {p.code} · {formatDateTime(p.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <PaymentStatusBadge status={p.status} />
                  <PaymentActions payment={p} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function AuditCard({ account }: { account: AdminAccountDetail }) {
  const { t } = useTranslation('backoffice');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.audit')}</CardTitle>
      </CardHeader>
      <CardContent>
        {account.audit.length === 0 ? (
          <p className="text-muted-foreground">{t('account.noAudit')}</p>
        ) : (
          <ol className="flex flex-col gap-3 border-l pl-4">
            {account.audit.map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5">
                <p className="text-sm">
                  <span className="font-mono">{e.action}</span>
                  {e.actorName ? ` · ${e.actorName}` : ''}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatDateTime(e.createdAt)} · {e.reason}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
