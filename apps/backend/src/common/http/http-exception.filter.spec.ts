import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { HttpExceptionFilter } from './http-exception.filter.js';

function run(exception: unknown) {
  const send = vi.fn((_body: { error: Record<string, unknown> }) => undefined);
  const status = vi.fn((_code: number) => ({ send }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ id: 'trace-1', url: '/x' }),
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

  it('still maps unknown errors to 500 INTERNAL', () => {
    const { status, body } = run(new Error('boom'));
    expect(status).toBe(500);
    expect(body?.error.code).toBe('INTERNAL');
  });
});
