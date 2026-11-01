import type { TFunction } from 'i18next';

import { ApiClientError } from '@/lib/api-client';

export type CredentialField = 'retailer' | 'clientId' | 'clientSecret';
export const CREDENTIAL_FIELDS: readonly CredentialField[] = [
  'retailer',
  'clientId',
  'clientSecret',
];

/** Where a failed KiotViet call shows its message (spec §8): under a field, the branches or the step. */
export interface KiotVietFailure {
  fields: Partial<Record<CredentialField, string>>;
  branches: string | null;
  banner: string | null;
  /** The credentials step must be fixed (wrong id/secret, unknown store, missing permissions). */
  credentials: boolean;
  /** 409: already connected, a sync running or a stale version; the caller decides the wording. */
  conflict: boolean;
}

const none = (): KiotVietFailure => ({
  fields: {},
  branches: null,
  banner: null,
  credentials: false,
  conflict: false,
});

const CREDENTIAL_REASONS = new Set([
  'kiotviet_auth',
  'kiotviet_retailer',
  'kiotviet_retailer_changed',
  'kiotviet_permission',
]);

/** Maps an error of the test / connect / update calls to the `integration` namespace messages. */
export function describeFailure(t: TFunction, error: unknown): KiotVietFailure {
  const out = none();
  if (!(error instanceof ApiClientError)) {
    out.banner = t('wizard.errors.generic');
    return out;
  }
  if (error.status === 409) {
    out.conflict = true;
    return out;
  }
  if (error.status === 503) {
    out.banner = t('wizard.errors.busy');
    return out;
  }
  const reason = error.details?.['reason'];
  out.credentials = typeof reason === 'string' && CREDENTIAL_REASONS.has(reason);
  switch (reason) {
    case 'kiotviet_auth':
      out.fields.clientId = t('wizard.errors.auth');
      out.fields.clientSecret = t('wizard.errors.auth');
      return out;
    case 'kiotviet_retailer':
      out.fields.retailer = t('wizard.errors.retailer');
      return out;
    case 'kiotviet_retailer_changed':
      out.fields.retailer = t('wizard.errors.retailerChanged');
      return out;
    case 'kiotviet_permission': {
      const missing = error.details?.['missing'];
      const names = Array.isArray(missing) ? missing.map(String) : [];
      const list = names
        .map((name) => t(`wizard.permissions.${name}`, { defaultValue: name }))
        .join(', ');
      out.banner = t('wizard.errors.permission', { list });
      return out;
    }
    case 'kiotviet_branch':
      out.branches = t('wizard.errors.branch');
      return out;
    default:
      out.banner = t('wizard.errors.generic');
      return out;
  }
}

/** Client-side check before calling the API: every credential is required. */
export function missingCredentials(
  t: TFunction,
  values: Record<CredentialField, string>,
): Partial<Record<CredentialField, string>> {
  const errors: Partial<Record<CredentialField, string>> = {};
  for (const field of CREDENTIAL_FIELDS) {
    if (!values[field].trim()) errors[field] = t(`wizard.errors.required.${field}`);
  }
  return errors;
}
