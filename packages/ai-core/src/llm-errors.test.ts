import { describe, expect, it } from 'vitest';

import { LlmCallError } from './gateway.js';
import { classifyLlmError, retryAfterMsOf } from './llm-errors.js';

const http = (status: number, message = 'x', headers?: unknown) =>
  Object.assign(new Error(message), { status, headers });

describe('classifyLlmError', () => {
  it('maps HTTP statuses', () => {
    expect(classifyLlmError(http(429))).toBe('rate_limit');
    for (const s of [500, 502, 503, 529]) expect(classifyLlmError(http(s))).toBe('overloaded');
    expect(classifyLlmError(http(401))).toBe('auth');
    expect(classifyLlmError(http(403))).toBe('auth');
    expect(classifyLlmError(http(400, 'maximum context length is 8192'))).toBe('context_too_long');
    expect(classifyLlmError(http(400, 'prompt exceeds the context length'))).toBe(
      'context_too_long',
    );
    for (const s of [400, 404, 422]) expect(classifyLlmError(http(s))).toBe('invalid_request');
    expect(classifyLlmError(http(400, 'blocked by content filter'))).toBe('content_filter');
  });

  it('maps abort, timeout and network failures', () => {
    expect(classifyLlmError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('aborted');
    expect(classifyLlmError(Object.assign(new Error('x'), { name: 'APIUserAbortError' }))).toBe(
      'aborted',
    );
    expect(
      classifyLlmError(Object.assign(new Error('x'), { name: 'APIConnectionTimeoutError' })),
    ).toBe('timeout');
    expect(classifyLlmError(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe(
      'timeout',
    );
    expect(classifyLlmError(Object.assign(new Error('boom'), { code: 'ECONNRESET' }))).toBe(
      'network',
    );
    expect(classifyLlmError(new TypeError('fetch failed'))).toBe('network');
  });

  it('passes LlmCallError through and defaults to unknown', () => {
    expect(classifyLlmError(new LlmCallError('content_filter', 'x'))).toBe('content_filter');
    expect(classifyLlmError(new Error('weird'))).toBe('unknown');
    expect(classifyLlmError('nope')).toBe('unknown');
  });
});

describe('retryAfterMsOf', () => {
  it('reads retry-after seconds from plain and Headers-like objects', () => {
    expect(retryAfterMsOf(http(429, 'x', { 'retry-after': '3' }))).toBe(3_000);
    expect(retryAfterMsOf(http(429, 'x', new Headers({ 'Retry-After': '2' })))).toBe(2_000);
    expect(retryAfterMsOf(http(429))).toBeUndefined();
    expect(retryAfterMsOf(new LlmCallError('rate_limit', 'x', 500))).toBe(500);
  });
});
