import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { useKiotVietWizard, WIZARD_STEPS } from '../hooks/use-kiotviet-wizard';
import { WizardBranchesStep } from './wizard-branches-step';
import { WizardCredentialsStep } from './wizard-credentials-step';
import { WizardReviewStep } from './wizard-review-step';

/** Connect wizard (spec §6.3): credentials → branches → preview & start. */
export function KiotVietWizard() {
  const { t } = useTranslation('integration');
  const w = useKiotVietWizard();
  const titles = t('wizard.steps', { returnObjects: true }) as unknown;
  const title = Array.isArray(titles) ? String(titles[w.step] ?? '') : '';
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const shown = useRef(w.step);
  // A new step focuses its title, unless the step already focused an invalid field (child
  // effects run first).
  useEffect(() => {
    if (shown.current === w.step) return;
    shown.current = w.step;
    if (!content.current?.contains(document.activeElement)) heading.current?.focus();
  }, [w.step]);

  return (
    <Card className="max-w-2xl">
      <CardHeader className="gap-3">
        <div className="flex gap-1.5" aria-hidden>
          {Array.from({ length: WIZARD_STEPS }, (_, i) => (
            <span
              key={i}
              className={cn('h-1.5 flex-1 rounded-full', i <= w.step ? 'bg-primary' : 'bg-muted')}
            />
          ))}
        </div>
        <p className="text-sm text-muted-foreground tabular-nums">
          {t('wizard.stepOf', { current: w.step + 1, total: WIZARD_STEPS })}
        </p>
        <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
          {title}
        </h2>
      </CardHeader>
      <CardContent ref={content}>
        {w.step === 0 ? (
          <WizardCredentialsStep
            values={w.credentials}
            errors={w.credentialErrors}
            banner={w.banner}
            attempt={w.attempt}
            testing={w.testing}
            onChange={w.setCredential}
            onSubmit={() => void w.check()}
          />
        ) : null}
        {w.step === 1 && w.result ? (
          <WizardBranchesStep
            branches={w.result.branches}
            value={w.selection}
            errors={w.branchErrors}
            attempt={w.attempt}
            reloading={w.testing}
            onChange={w.changeSelection}
            onReload={() => void w.reloadBranches()}
            onBack={w.back}
            onNext={w.next}
          />
        ) : null}
        {w.step === 2 && w.result ? (
          <WizardReviewStep
            result={w.result}
            banner={w.banner}
            starting={w.starting}
            toggles={w.toggles}
            onTogglesChange={w.setToggles}
            onBack={w.back}
            onStart={() => void w.start()}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
