import type { KiotVietTestResponse } from '@agent-sales/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useConnectKiotViet, useTestKiotViet } from '../api/integrations';
import type { CredentialValues } from '../components/credentials-fields';
import {
  type BranchErrors,
  type BranchSelection,
  defaultSelection,
  reconcileSelection,
  validateSelection,
} from '../lib/branches';
import { type CredentialField, describeFailure, missingCredentials } from '../lib/errors';

export type WizardStep = 0 | 1 | 2;
export const WIZARD_STEPS = 3;

const EMPTY: CredentialValues = { retailer: '', clientId: '', clientSecret: '' };

/**
 * State of the 3-step connect wizard (spec §6.3). Values survive Back; each failed step bumps
 * `attempt` so the step focuses its first invalid field.
 */
export function useKiotVietWizard() {
  const { t } = useTranslation('integration');
  const test = useTestKiotViet();
  const connect = useConnectKiotViet();
  const [step, setStep] = useState<WizardStep>(0);
  const [credentials, setCredentials] = useState<CredentialValues>(EMPTY);
  const [credentialErrors, setCredentialErrors] = useState<
    Partial<Record<CredentialField, string>>
  >({});
  const [banner, setBanner] = useState<string | null>(null);
  const [result, setResult] = useState<KiotVietTestResponse | null>(null);
  const [selection, setSelection] = useState<BranchSelection>(defaultSelection([]));
  const [branchErrors, setBranchErrors] = useState<BranchErrors>({});
  const [pushOrders, setPushOrders] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const fail = () => setAttempt((n) => n + 1);

  const go = (next: WizardStep) => {
    setBanner(null);
    setStep(next);
  };

  function setCredential(field: CredentialField, value: string) {
    setCredentials((c) => ({ ...c, [field]: value }));
    setCredentialErrors((e) => {
      if (!e[field]) return e;
      // A rejected pair clears together: fixing either may fix the pair.
      const next = { ...e };
      delete next[field];
      if (field === 'clientId' || field === 'clientSecret') {
        delete next.clientId;
        delete next.clientSecret;
      }
      return next;
    });
  }

  function changeSelection(next: BranchSelection) {
    setSelection(next);
    setBranchErrors({});
  }

  async function check() {
    const missing = missingCredentials(t, credentials);
    if (Object.keys(missing).length) {
      setCredentialErrors(missing);
      fail();
      return;
    }
    setBanner(null);
    try {
      const response = await test.mutateAsync(credentials);
      setResult(response);
      setSelection((current) => reconcileSelection(response.branches, current));
      setCredentialErrors({});
      go(1);
    } catch (error) {
      const failure = describeFailure(t, error);
      setCredentialErrors(failure.fields);
      setBanner(failure.banner ?? (failure.conflict ? t('wizard.errors.generic') : null));
      fail();
    }
  }

  /** Re-reads the store's branches after KiotViet said a picked one is gone. */
  async function reloadBranches() {
    try {
      const response = await test.mutateAsync(credentials);
      setResult(response);
      setSelection(defaultSelection(response.branches));
      setBranchErrors({});
    } catch (error) {
      const failure = describeFailure(t, error);
      setBranchErrors({
        branches: failure.banner ?? failure.branches ?? t('wizard.errors.generic'),
      });
    }
  }

  function next() {
    const errors = validateSelection(selection, {
      branches: t('wizard.errors.branchesRequired'),
      orderBranch: t('wizard.errors.orderBranchRequired'),
    });
    setBranchErrors(errors);
    if (errors.branches || errors.orderBranch) {
      fail();
      return;
    }
    go(2);
  }

  async function start(): Promise<boolean> {
    if (selection.orderBranchId === null) return false;
    setBanner(null);
    try {
      await connect.mutateAsync({
        ...credentials,
        settings: {
          saleBranchIds: selection.saleBranchIds,
          orderBranchId: selection.orderBranchId,
          pushOrders,
          // Still "Sắp có" (PR 3); on by default so it starts without a re-save.
          syncCustomers: true,
        },
      });
      toast.success(t('wizard.connected'));
      return true;
    } catch (error) {
      const failure = describeFailure(t, error);
      if (failure.conflict) {
        // Someone connected meanwhile: the refreshed list swaps the page to the connection view.
        toast.error(t('wizard.errors.alreadyConnected'));
        return false;
      }
      if (failure.branches) {
        setBranchErrors({ branches: failure.branches });
        go(1);
      } else if (failure.credentials) {
        setCredentialErrors(failure.fields);
        go(0);
      }
      setBanner(failure.banner);
      fail();
      return false;
    }
  }

  return {
    step,
    back: () => go(step === 2 ? 1 : 0),
    credentials,
    credentialErrors,
    setCredential,
    banner,
    result,
    selection,
    changeSelection,
    branchErrors,
    attempt,
    pushOrders,
    setPushOrders,
    check,
    testing: test.isPending,
    reloadBranches,
    next,
    start,
    starting: connect.isPending,
  };
}
