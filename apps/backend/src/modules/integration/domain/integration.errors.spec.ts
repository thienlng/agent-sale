import { DomainError } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import {
  ConnectionExistsError,
  ConnectionNotFoundError,
  KiotVietAuthError,
  KiotVietPermissionError,
  KiotVietRetailerError,
  KiotVietUnavailableError,
  SyncAlreadyRunningError,
} from './integration.errors.js';

describe('integration errors', () => {
  it.each([
    [new KiotVietAuthError(), 'VALIDATION_FAILED', { reason: 'kiotviet_auth' }],
    [new KiotVietRetailerError(), 'VALIDATION_FAILED', { reason: 'kiotviet_retailer' }],
    [
      new KiotVietPermissionError(['customers', 'orders']),
      'VALIDATION_FAILED',
      { reason: 'kiotviet_permission', missing: ['customers', 'orders'] },
    ],
    [new KiotVietUnavailableError(), 'UNAVAILABLE', { reason: 'kiotviet_unavailable' }],
    [new ConnectionExistsError('kiotviet'), 'CONFLICT', { provider: 'kiotviet' }],
    [new ConnectionNotFoundError('kiotviet'), 'NOT_FOUND', { provider: 'kiotviet' }],
    [new SyncAlreadyRunningError(), 'CONFLICT', { reason: 'sync_running' }],
  ])('%s carries its code and details', (error, code, details) => {
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe(code);
    expect(error.details).toEqual(details);
  });
});
