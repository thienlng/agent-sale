import { OrderPolicyField } from '@agent-sales/contracts';
import type { TFunction } from 'i18next';
import { z } from 'zod';

import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';

const MissingFields = z.object({ fields: z.array(OrderPolicyField).min(1) });

/** The fields a source policy says are missing, when that is what the error is about. */
export function missingFieldsOf(err: unknown): OrderPolicyField[] {
  if (!(err instanceof ApiClientError) || err.code !== 'VALIDATION_FAILED') return [];
  const parsed = MissingFields.safeParse(err.details);
  return parsed.success ? parsed.data.fields : [];
}

/** A user-facing sentence for an order API error, naming missing fields and locked lines. */
export function orderErrorMessage(t: TFunction, err: unknown): string {
  const missing = missingFieldsOf(err);
  if (missing.length) {
    const fields = missing.map((f) => t(`orderSettings.policy.fields.${f}`)).join(', ');
    return t('orderForm.fieldsRequired', { fields });
  }
  if (err instanceof ApiClientError && err.code === 'CONFLICT') {
    if (err.details && 'stockState' in err.details) return t('orderDetail.itemsLocked');
    return t('orderDetail.conflict');
  }
  return errorMessage(t, err);
}
