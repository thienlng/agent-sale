import type { ArgumentsHost } from '@nestjs/common';
import { DomainError } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import { HttpExceptionFilter } from './http-exception.filter.js';

function run(exception: unknown, url = '/x') {
  const send = vi.fn((_body: { error: Record<string, unknown> }) => undefined);
  const status = vi.fn((_code: number) => ({ send }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ id: 'trace-1', url }),
    }),
  } as unknown as ArgumentsHost;
  const logger = { error: vi.fn() };
  new HttpExceptionFilter(logger as never).catch(exception, host);
  return { status: status.mock.calls[0]?.[0], body: send.mock.calls[0]?.[0], logger };
}

describe('HttpExceptionFilter', () => {
  it('answers 413 with the standard envelope for an oversized body', () => {
    const err = Object.assign(new Error('Request body is too large'), {
      code: 'FST_ERR_CTP_BODY_TOO_LARGE',
      statusCode: 413,
    });
    const { status, body, logger } = run(err);
    expect(status).toBe(413);
    expect(body?.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { reason: 'PAYLOAD_TOO_LARGE' },
      traceId: 'trace-1',
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('answers 409 CONFLICT for a module-specific domain code and keeps it as the reason', () => {
    class TakenError extends DomainError {
      readonly code = 'NIGHTS_TAKEN';
    }
    const { status, body } = run(new TakenError('Nights are taken', { codes: ['BK-0001'] }));
    expect(status).toBe(409);
    expect(body?.error).toMatchObject({
      code: 'CONFLICT',
      message: 'Nights are taken',
      details: { codes: ['BK-0001'], reason: 'NIGHTS_TAKEN' },
    });
  });

  it('still maps unknown errors to 500 INTERNAL', () => {
    const { status, body } = run(new Error('boom'));
    expect(status).toBe(500);
    expect(body?.error.code).toBe('INTERNAL');
  });

  it('logs the path of a 500 without its query string', () => {
    const { logger } = run(new Error('boom'), '/api/v1/contacts?q=0901234567&page=2');
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [fields] = logger.error.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(fields).toMatchObject({ traceId: 'trace-1', url: '/api/v1/contacts' });
    expect(JSON.stringify(fields)).not.toContain('0901234567');
  });
});
