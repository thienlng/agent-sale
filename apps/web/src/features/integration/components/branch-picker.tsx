import type { KiotVietBranch } from '@agent-sales/contracts';
import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { type BranchErrors, type BranchSelection, toggleBranch } from '../lib/branches';

/**
 * Sale branches (checkbox list) and the order branch among them. Shared by the wizard and the
 * connection settings. `attempt` changes after a failed submit and focuses the first invalid control.
 */
export function BranchPicker({
  branches,
  value,
  errors,
  attempt,
  disabled,
  onChange,
}: {
  branches: readonly KiotVietBranch[];
  value: BranchSelection;
  errors: BranchErrors;
  attempt: number;
  disabled?: boolean;
  onChange: (next: BranchSelection) => void;
}) {
  const { t } = useTranslation('integration');
  const id = useId();
  const firstBox = useRef<HTMLButtonElement>(null);
  const orderTrigger = useRef<HTMLButtonElement>(null);
  const latestErrors = useRef(errors);
  latestErrors.current = errors;
  useEffect(() => {
    if (attempt === 0) return;
    if (latestErrors.current.branches) firstBox.current?.focus();
    else if (latestErrors.current.orderBranch) orderTrigger.current?.focus();
  }, [attempt]);

  const ticked = branches.filter((b) => value.saleBranchIds.includes(b.id));
  const branchesError = errors.branches ? `${id}-branches-error` : undefined;
  const orderError = errors.orderBranch ? `${id}-order-error` : undefined;

  return (
    <div className="flex flex-col gap-6">
      <fieldset
        className="flex min-w-0 flex-col gap-2"
        aria-describedby={[`${id}-branches-help`, branchesError].filter(Boolean).join(' ')}
      >
        <legend className="mb-2 text-sm font-medium">{t('wizard.branchesTitle')}</legend>
        <p id={`${id}-branches-help`} className="text-sm text-muted-foreground">
          {t('wizard.branchesHelp')}
        </p>
        {branches.length ? (
          <ul className="flex flex-col divide-y rounded-lg border">
            {branches.map((branch, index) => {
              const boxId = `${id}-branch-${branch.id}`;
              return (
                <li key={branch.id}>
                  <label
                    htmlFor={boxId}
                    className="flex min-h-11 cursor-pointer items-start gap-3 px-3 py-3 has-disabled:cursor-default"
                  >
                    <Checkbox
                      id={boxId}
                      ref={index === 0 ? firstBox : undefined}
                      className="mt-0.5"
                      checked={value.saleBranchIds.includes(branch.id)}
                      disabled={disabled}
                      aria-labelledby={`${boxId}-name`}
                      aria-describedby={branch.address ? `${boxId}-address` : undefined}
                      aria-invalid={Boolean(errors.branches) || undefined}
                      onCheckedChange={(checked) =>
                        onChange(toggleBranch(value, branch.id, checked === true))
                      }
                    />
                    <span className="flex min-w-0 flex-col">
                      <span id={`${boxId}-name`} className="text-sm font-medium break-words">
                        {branch.name}
                      </span>
                      {branch.address ? (
                        <span
                          id={`${boxId}-address`}
                          className="text-sm break-words text-muted-foreground"
                        >
                          {branch.address}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('wizard.errors.noBranches')}</p>
        )}
        {errors.branches ? (
          <p id={branchesError} className="text-sm text-destructive">
            {errors.branches}
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-order`}>{t('wizard.orderBranch')}</Label>
        <Select
          value={value.orderBranchId === null ? '' : String(value.orderBranchId)}
          disabled={disabled || !ticked.length}
          onValueChange={(v) => onChange({ ...value, orderBranchId: Number(v) })}
        >
          <SelectTrigger
            id={`${id}-order`}
            ref={orderTrigger}
            className="h-11 w-full sm:max-w-sm"
            aria-invalid={Boolean(errors.orderBranch) || undefined}
            aria-describedby={[`${id}-order-help`, orderError].filter(Boolean).join(' ')}
          >
            <SelectValue placeholder={t('wizard.orderBranchPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {ticked.map((branch) => (
              <SelectItem key={branch.id} value={String(branch.id)}>
                {branch.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p id={`${id}-order-help`} className="text-sm text-muted-foreground">
          {t('wizard.orderBranchHelp')}
        </p>
        {errors.orderBranch ? (
          <p id={orderError} className="text-sm text-destructive">
            {errors.orderBranch}
          </p>
        ) : null}
      </div>
    </div>
  );
}
