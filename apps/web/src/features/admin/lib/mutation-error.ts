import type { TFunction } from 'i18next';
import { toast } from 'sonner';

import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';

/**
 * Toasts a failed admin write. A 409 means someone else changed the row in between: the mutation
 * already refetched it, so the operator only has to check and retry.
 */
export function toastAdminError(t: TFunction, error: unknown): void {
  if (error instanceof ApiClientError && error.status === 409) {
    toast.error(t('backoffice:common.conflict'));
    return;
  }
  toast.error(errorMessage(t, error));
}

export const validReason = (reason: string) => reason.trim().length >= 3;
