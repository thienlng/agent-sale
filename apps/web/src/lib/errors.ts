import type { TFunction } from 'i18next';

import { ApiClientError } from './api-client';

/** A user-facing sentence for an API error (never the raw server message for 5xx). */
export function errorMessage(t: TFunction, error: unknown): string {
  if (error instanceof ApiClientError) {
    const reason = error.details?.['reason'];
    // Refusals that are about who is asking, not about the role (docs/09 §2).
    if (reason === 'reauth_required') return t('stepUp.required');
    if (reason === 'mfa_session_required') return t('stepUp.adminHint');
    if (reason === 'admin_mfa_required') return t('stepUp.adminMfaRequired');
    if (error.code === 'CONFLICT') return t('errors.conflict');
    if (error.code === 'FORBIDDEN') return t('errors.forbidden');
    if (error.code === 'QUOTA_EXCEEDED') return t('errors.quotaExceeded');
    if (error.status >= 500 || error.code === 'INTERNAL') return t('auth.errors.generic');
    return error.message;
  }
  return t('auth.errors.generic');
}
