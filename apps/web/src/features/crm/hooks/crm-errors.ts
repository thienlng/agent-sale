import type { TFunction } from 'i18next';

import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';

/** A user-facing sentence for a CRM API error: stale edits, duplicate names, invalid fields, non-members. */
export function crmErrorMessage(t: TFunction, err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === 'CONFLICT' && err.details && 'version' in err.details) return t('crm.stale');
    if (err.code === 'CONFLICT' && typeof err.details?.['name'] === 'string') {
      return t('crm.errors.duplicateName', { name: err.details['name'] });
    }
    const fields = err.details?.['fields'];
    if (err.code === 'VALIDATION_FAILED' && fields && typeof fields === 'object') {
      return t('crm.errors.fieldsInvalid', { fields: Object.keys(fields).join(', ') });
    }
    if (err.code === 'VALIDATION_FAILED' && err.details && 'role' in err.details) {
      return t('crm.errors.notMember');
    }
  }
  return errorMessage(t, err);
}

/** Display name of a contact: name, else phone, else email. */
export function contactLabel(
  c: { name: string | null; phone: string | null; email: string | null },
  t: TFunction,
): string {
  return c.name || c.phone || c.email || t('crm.noName');
}
