import { Link } from '@tanstack/react-router';
import { ShieldAlert } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { StepUpDialog } from '@/components/step-up-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useStepUpStatus } from '@/hooks/use-step-up';

/**
 * The back office needs two-step verification on the account and a sign-in that passed it (the API
 * answers 403 `admin_mfa_required` / `mfa_session_required` otherwise, docs/09 §2). Says which one
 * is missing instead of a page of failed loads.
 */
export function SecondFactorGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation('backoffice');
  const status = useStepUpStatus();
  const [confirming, setConfirming] = useState(false);

  if (status.isPending) return <Skeleton className="h-32 max-w-xl" />;
  // If the state cannot be read, let the pages load and show their own errors.
  if (status.isError || status.data.mfa) return <>{children}</>;

  const enrolled = status.data.methods.includes('totp');
  return (
    <section className="flex max-w-xl flex-col gap-3 rounded-lg border p-5" role="alert">
      <h1 className="flex items-center gap-2 text-lg font-semibold">
        <ShieldAlert aria-hidden className="size-5 text-destructive" />
        {enrolled ? t('common.secondFactor.confirmTitle') : t('common.secondFactor.title')}
      </h1>
      <p className="text-sm text-muted-foreground">
        {enrolled ? t('common.secondFactor.confirmBody') : t('common.secondFactor.body')}
      </p>
      <div>
        {enrolled ? (
          <Button onClick={() => setConfirming(true)}>{t('common.secondFactor.confirm')}</Button>
        ) : (
          <Button asChild>
            <Link to="/app/settings/security">{t('common.secondFactor.action')}</Link>
          </Button>
        )}
      </div>
      <StepUpDialog
        open={confirming}
        reason="mfa_session_required"
        onDone={() => setConfirming(false)}
      />
    </section>
  );
}
