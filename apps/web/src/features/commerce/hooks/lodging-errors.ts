import type { TFunction } from 'i18next';
import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';

/** Lodging conflicts can mean overlapping dates, a stale version, or a reused request key. */
export function lodgingErrorMessage(t: TFunction, error: unknown): string {
  return error instanceof ApiClientError && error.code === 'CONFLICT'
    ? t('lodging.conflict')
    : errorMessage(t, error);
}
