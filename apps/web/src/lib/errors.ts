import type { TFunction } from 'i18next';

import { ApiClientError } from './api-client';

/** A user-facing sentence for an API error (never the raw server message for 5xx). */
export function errorMessage(t: TFunction, error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'CONFLICT') return t('errors.conflict');
    if (error.code === 'FORBIDDEN') return t('errors.forbidden');
    if (error.status >= 500 || error.code === 'INTERNAL') return t('auth.errors.generic');
    return error.message;
  }
  return t('auth.errors.generic');
}
