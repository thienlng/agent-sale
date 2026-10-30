import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@/lib/api-client';
import { selectionErrorKey } from './selection-error';

describe('selectionErrorKey', () => {
  it('explains that the page belongs to another business on CONFLICT', () => {
    const conflict = new ApiClientError(
      409,
      'CONFLICT',
      'This account is connected to another workspace',
    );
    expect(selectionErrorKey(conflict)).toBe('integrations.pageInOtherBusiness');
  });
  it('keeps the permission message for anything else', () => {
    expect(selectionErrorKey(new ApiClientError(400, 'VALIDATION_FAILED', 'x'))).toBe(
      'connectionError',
    );
    expect(selectionErrorKey(new Error('network'))).toBe('connectionError');
  });
});
