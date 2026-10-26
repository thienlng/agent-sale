import type { ActionParam } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import { buildRequest, type RequestSpec } from '../domain/build-request.js';

const p = (
  name: string,
  location: ActionParam['location'],
  type: ActionParam['type'] = 'string',
  required = true,
): ActionParam => ({ name, type, location, required, description: 'd' });

const spec = (over: Partial<RequestSpec> = {}): RequestSpec => ({
  url: 'https://shop.example.com/api/orders/{code}',
  method: 'GET',
  params: [p('code', 'path')],
  auth: { kind: 'none' },
  ...over,
});

const ok = (r: ReturnType<typeof buildRequest>) => {
  if (!r.ok) throw new Error('expected ok');
  return r.request;
};

describe('buildRequest', () => {
  it('places path params URL-encoded and keeps traversal inert', () => {
    expect(ok(buildRequest(spec(), { code: 'A 1/2' }, null, 'k')).url).toBe(
      'https://shop.example.com/api/orders/A%201%2F2',
    );
    expect(ok(buildRequest(spec(), { code: '%2e%2e' }, null, 'k')).url).toBe(
      'https://shop.example.com/api/orders/%252e%252e',
    );
    for (const bad of ['..', '.', '']) {
      expect(buildRequest(spec(), { code: bad }, null, 'k')).toEqual({
        ok: false,
        errorCode: 'invalid_args',
      });
    }
  });

  it('validates required, types and drops unknown keys', () => {
    expect(buildRequest(spec(), {}, null, 'k')).toEqual({ ok: false, errorCode: 'invalid_args' });
    expect(buildRequest(spec(), { code: 5 }, null, 'k').ok).toBe(false);
    expect(buildRequest(spec(), { code: 'x'.repeat(501) }, null, 'k').ok).toBe(false);
    const r = ok(buildRequest(spec(), { code: 'A', evil: 'x' }, null, 'k'));
    expect(r.url).not.toContain('evil');
  });

  it('coerces only strings to number and boolean', () => {
    const s = spec({
      params: [p('code', 'path'), p('n', 'query', 'number'), p('f', 'query', 'boolean')],
    });
    expect(ok(buildRequest(s, { code: 'A', n: '12.5', f: 'true' }, null, 'k')).url).toBe(
      'https://shop.example.com/api/orders/A?n=12.5&f=true',
    );
    expect(buildRequest(s, { code: 'A', n: 'abc', f: true }, null, 'k').ok).toBe(false);
    expect(buildRequest(s, { code: 'A', n: 1, f: 'yes' }, null, 'k').ok).toBe(false);
    expect(buildRequest(s, { code: 'A', n: Number.NaN, f: true }, null, 'k').ok).toBe(false);
  });

  it('encodes query values and skips absent optional ones', () => {
    const s = spec({
      url: 'https://shop.example.com/search',
      params: [p('q', 'query'), p('page', 'query', 'number', false)],
    });
    expect(ok(buildRequest(s, { q: 'a&b=c d' }, null, 'k')).url).toBe(
      'https://shop.example.com/search?q=a%26b%3Dc+d',
    );
  });

  it('sends a JSON body for body params on writes', () => {
    const s = spec({
      url: 'https://shop.example.com/book',
      method: 'POST',
      params: [p('name', 'body'), p('seats', 'body', 'number')],
    });
    const r = ok(buildRequest(s, { name: 'An', seats: '2' }, null, 'idem-1'));
    expect(JSON.parse(r.body ?? '')).toEqual({ name: 'An', seats: 2 });
    expect(r.headers['Content-Type']).toBe('application/json');
    expect(r.headers['Idempotency-Key']).toBe('idem-1');
  });

  it('sends no Idempotency-Key on GET', () => {
    expect(ok(buildRequest(spec(), { code: 'A' }, null, 'k')).headers['Idempotency-Key']).toBe(
      undefined,
    );
  });

  it('allows safe header params and refuses injection or reserved names', () => {
    const s = spec({ params: [p('code', 'path'), p('X-Shop', 'header')] });
    expect(ok(buildRequest(s, { code: 'A', 'X-Shop': 'main' }, null, 'k')).headers['X-Shop']).toBe(
      'main',
    );
    expect(buildRequest(s, { code: 'A', 'X-Shop': 'a\r\nX-Evil: 1' }, null, 'k').ok).toBe(false);
    for (const name of ['Host', 'authorization', 'Cookie', 'Content-Length', 'Idempotency-Key']) {
      const bad = spec({ params: [p('code', 'path'), p(name, 'header')] });
      expect(buildRequest(bad, { code: 'A', [name]: 'v' }, null, 'k').ok).toBe(false);
    }
  });

  it('adds the auth header from the secret', () => {
    const bearer = buildRequest(spec({ auth: { kind: 'bearer' } }), { code: 'A' }, 's3cret', 'k');
    expect(ok(bearer).headers['Authorization']).toBe('Bearer s3cret');
    const key = buildRequest(
      spec({ auth: { kind: 'api_key', headerName: 'X-Api-Key' } }),
      { code: 'A' },
      's3cret',
      'k',
    );
    expect(ok(key).headers['X-Api-Key']).toBe('s3cret');
    expect(
      buildRequest(spec({ auth: { kind: 'bearer' } }), { code: 'A' }, 'bad\r\nx', 'k').ok,
    ).toBe(false);
  });
});
