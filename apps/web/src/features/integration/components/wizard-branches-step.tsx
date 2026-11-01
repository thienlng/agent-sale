import type { KiotVietBranch } from '@agent-sales/contracts';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import type { BranchErrors, BranchSelection } from '../lib/branches';
import { BranchPicker } from './branch-picker';

/** Step 2: which branches sell online, and which one receives orders. */
export function WizardBranchesStep({
  branches,
  value,
  errors,
  attempt,
  reloading,
  onChange,
  onReload,
  onBack,
  onNext,
}: {
  branches: readonly KiotVietBranch[];
  value: BranchSelection;
  errors: BranchErrors;
  attempt: number;
  reloading: boolean;
  onChange: (next: BranchSelection) => void;
  onReload: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation('integration');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onNext();
  };
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-6">
      <BranchPicker
        branches={branches}
        value={value}
        errors={errors}
        attempt={attempt}
        disabled={reloading}
        onChange={onChange}
      />
      {errors.branches ? (
        <Button
          type="button"
          variant="outline"
          className="h-11 self-start"
          disabled={reloading}
          onClick={onReload}
        >
          {reloading ? (
            <LoaderCircle aria-hidden className="motion-safe:animate-spin" />
          ) : (
            <RefreshCw aria-hidden />
          )}
          {t('wizard.reloadBranches')}
        </Button>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button type="button" variant="ghost" size="lg" className="h-11" onClick={onBack}>
          {t('wizard.back')}
        </Button>
        <Button type="submit" size="lg" className="h-11" disabled={reloading}>
          {t('wizard.next')}
        </Button>
      </div>
    </form>
  );
}
