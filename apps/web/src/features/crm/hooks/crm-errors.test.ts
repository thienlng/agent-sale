import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { ApiClientError } from '@/lib/api-client';

import { crmErrorMessage } from './crm-errors';

const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}:${JSON.stringify(opts)}` : key) as unknown as TFunction;

describe('crmErrorMessage', () => {
  it('names the clashing tag or status (T-089)', () => {
    const err = new ApiClientError(409, 'CONFLICT', 'exists', undefined, {
      kind: 'status',
      name: 'VIP',
    });
    expect(crmErrorMessage(t, err)).toBe('crm.errors.duplicateName:{"name":"VIP"}');
  });

  it('still reports a stale edit as such', () => {
    const err = new ApiClientError(409, 'CONFLICT', 'stale', undefined, {
      entity: 'tag',
      version: 3,
    });
    expect(crmErrorMessage(t, err)).toBe('crm.stale');
  });
});
