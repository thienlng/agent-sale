import { describe, expect, it } from 'vitest';

import {
  ActionAssistantDraft,
  ActionDto,
  ActionInput,
  ActionTestRequest,
  HOST_PLACEHOLDER,
  looksLikeSecretName,
  sameSecretTarget,
  SECRET_IN_DRAFT,
  UpdateActionRequest,
} from './index.js';

const valid = {
  name: 'Order lookup',
  description: 'Look up the status of an order by its code.',
  url: 'https://shop.example.com/api/orders/{orderCode}',
  method: 'GET',
  params: [
    {
      name: 'orderCode',
      type: 'string',
      location: 'path',
      required: true,
      description: 'The order code',
    },
  ],
  responses: [
    {
      statusCode: 200,
      fields: [{ name: 'status', type: 'string', description: 'Order status' }],
    },
  ],
  auth: { kind: 'none' },
  requiresConfirm: false,
  enabled: true,
};

describe('ActionAssistantDraft', () => {
  const draft = { ...valid, enabled: false };

  it('accepts a disabled draft without a secret', () => {
    expect(ActionAssistantDraft.safeParse(draft).success).toBe(true);
  });

  it('rejects a secret, even an empty one, instead of stripping it', () => {
    expect(ActionAssistantDraft.safeParse({ ...draft, authSecret: 'k' }).success).toBe(false);
    expect(ActionAssistantDraft.safeParse({ ...draft, authSecret: '' }).success).toBe(false);
  });

  it('rejects an enabled draft and unknown keys', () => {
    expect(ActionAssistantDraft.safeParse({ ...draft, enabled: true }).success).toBe(false);
    expect(ActionAssistantDraft.safeParse({ ...draft, extra: 1 }).success).toBe(false);
  });

  it('is strict all the way down: a nested auth.token or unknown param key is rejected', () => {
    for (const body of [
      { ...draft, auth: { kind: 'bearer', token: 'x' } },
      { ...draft, auth: { kind: 'api_key', headerName: 'X-Api-Key', value: 'x' } },
      { ...draft, params: [{ ...draft.params[0], value: 'x' }] },
      { ...draft, responses: [{ ...draft.responses[0], secret: 'x' }] },
    ])
      expect(ActionAssistantDraft.safeParse(body).success).toBe(false);
  });

  it('refuses secret-looking URL query keys and header params with secret_in_draft', () => {
    const messages = (body: unknown) =>
      ActionAssistantDraft.safeParse(body).error?.issues.map((i) => i.message) ?? [];
    expect(messages({ ...draft, url: `${draft.url}?access_token=abc` })).toContain(SECRET_IN_DRAFT);
    expect(
      messages({
        ...draft,
        params: [
          ...draft.params,
          {
            name: 'X-Signature',
            type: 'string',
            location: 'header',
            required: true,
            description: 'x',
          },
        ],
      }),
    ).toContain(SECRET_IN_DRAFT);
    expect(messages({ ...draft, url: `${draft.url}?lang=vi&page=1` })).toEqual([]);
    // The api_key header name is where the form puts the secret, so it stays allowed.
    expect(messages({ ...draft, auth: { kind: 'api_key', headerName: 'X-Api-Key' } })).toEqual([]);
    expect(['apiKey', 'X-Auth', 'client_secret', 'pwd_password'].every(looksLikeSecretName)).toBe(
      true,
    );
    expect(['X-Shop-Id', 'monkey', 'lang', 'author'].some(looksLikeSecretName)).toBe(false);
  });

  it('keeps the cross-field rules of ActionInput', () => {
    expect(ActionAssistantDraft.safeParse({ ...draft, params: [] }).success).toBe(false);
  });
});

describe('ActionInput', () => {
  it('accepts a valid action and applies no secret by default', () => {
    const parsed = ActionInput.parse(valid);
    expect(parsed.authSecret).toBeUndefined();
  });

  it('rejects a plain http URL', () => {
    expect(ActionInput.safeParse({ ...valid, url: 'http://shop.example.com/x' }).success).toBe(
      false,
    );
  });

  it('refuses a {placeholder} in the host, port or userinfo', () => {
    const path = [{ ...valid.params[0], name: 'h' }];
    for (const url of [
      'https://{h}/api',
      'https://{h}.example.com/api',
      'https://shop.example.com:{h}/api',
      'https://{h}@shop.example.com/api',
    ]) {
      const parsed = ActionInput.safeParse({ ...valid, url, params: path });
      expect(parsed.success, url).toBe(false);
      expect(JSON.stringify(parsed.error?.issues), url).toContain(HOST_PLACEHOLDER);
    }
    expect(
      ActionInput.safeParse({ ...valid, url: 'https://shop.example.com/{h}?q=1', params: path })
        .success,
    ).toBe(true);
  });

  it('rejects a {placeholder} without a matching path param', () => {
    expect(ActionInput.safeParse({ ...valid, params: [] }).success).toBe(false);
    const wrongLocation = [{ ...valid.params[0], location: 'query' }];
    expect(ActionInput.safeParse({ ...valid, params: wrongLocation }).success).toBe(false);
  });

  it('rejects duplicate param names and invalid param names', () => {
    const p = valid.params[0];
    expect(ActionInput.safeParse({ ...valid, params: [p, p] }).success).toBe(false);
    expect(ActionInput.safeParse({ ...valid, params: [{ ...p, name: '1bad name' }] }).success).toBe(
      false,
    );
  });

  it('limits params, responses and response status codes', () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      name: `q${i}`,
      type: 'string',
      location: 'query',
      required: false,
      description: 'x',
    }));
    expect(
      ActionInput.safeParse({ ...valid, url: 'https://a.example.com/x', params: many }).success,
    ).toBe(false);
    expect(
      ActionInput.safeParse({ ...valid, responses: [{ statusCode: 99, fields: [] }] }).success,
    ).toBe(false);
  });

  it('requires a header name for api_key auth', () => {
    expect(ActionInput.safeParse({ ...valid, auth: { kind: 'api_key' } }).success).toBe(false);
    expect(
      ActionInput.safeParse({ ...valid, auth: { kind: 'api_key', headerName: 'X-Api-Key' } })
        .success,
    ).toBe(true);
    expect(ActionInput.safeParse({ ...valid, auth: { kind: 'bearer' } }).success).toBe(true);
  });
});

describe('ActionInput header and body rules', () => {
  const p = valid.params[0];
  const header = (name: string) => ({
    name,
    type: 'string',
    location: 'header',
    required: false,
    description: 'x',
  });
  const withParams = (params: unknown[], extra: object = {}) =>
    ActionInput.safeParse({ ...valid, params: [p, ...params], ...extra });

  it('rejects header params named like reserved headers', () => {
    for (const name of [
      'Host',
      'authorization',
      'Cookie',
      'Content-Length',
      'content-type',
      'Idempotency-Key',
      'Accept',
      'Proxy-Authorization',
      'Sec-Fetch-Mode',
    ])
      expect(withParams([header(name)]).success, name).toBe(false);
    expect(withParams([header('X-Customer')]).success).toBe(true);
  });

  it('rejects a header param that equals the api_key header name, ignoring case', () => {
    const auth = { kind: 'api_key', headerName: 'X-Api-Key' };
    expect(withParams([header('x-api-key')], { auth }).success).toBe(false);
    expect(withParams([header('X-Other')], { auth }).success).toBe(true);
  });

  it('rejects body params on GET but not on POST', () => {
    const body = { ...header('note'), location: 'body' };
    expect(withParams([body]).success).toBe(false);
    expect(withParams([body], { method: 'POST' }).success).toBe(true);
  });

  it('rejects duplicate param names that differ only by case', () => {
    expect(
      withParams([
        { ...header('Q1'), location: 'query' },
        { ...header('q1'), location: 'query' },
      ]).success,
    ).toBe(false);
  });
});

describe('other action schemas', () => {
  it('lets an update patch be partial', () => {
    expect(UpdateActionRequest.parse({ enabled: false })).toEqual({ enabled: false });
  });

  it('does not allow authSecret in a DTO', () => {
    const dto = ActionDto.parse({
      ...valid,
      authSecret: 'leak',
      id: '0190a000-0000-7000-8000-000000000001',
      botId: '0190a000-0000-7000-8000-000000000002',
      hasSecret: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect('authSecret' in dto).toBe(false);
  });

  it('accepts primitive test args only', () => {
    expect(ActionTestRequest.safeParse({ args: { a: 'x', b: 1, c: true } }).success).toBe(true);
    expect(ActionTestRequest.safeParse({ args: { a: { nested: 1 } } }).success).toBe(false);
  });
});

describe('sameSecretTarget', () => {
  const key = { kind: 'api_key', headerName: 'X-Api-Key' } as const;
  const at = (url: string, auth: Parameters<typeof sameSecretTarget>[0]['auth'] = key) => ({
    url,
    auth,
  });
  const stored = at('https://shop.example.com/api/orders/{code}');

  it('keeps the secret on the same origin and auth', () => {
    expect(sameSecretTarget(at('https://shop.example.com/v2/{code}?x=1'), stored)).toBe(true);
    expect(sameSecretTarget(at('https://SHOP.example.com:443/a'), stored)).toBe(true);
    expect(
      sameSecretTarget(
        at('https://shop.example.com/a', { ...key, headerName: 'x-api-key' }),
        stored,
      ),
    ).toBe(true);
  });

  it('refuses another origin, auth kind or header name', () => {
    expect(sameSecretTarget(at('https://api.shop.example.com/a'), stored)).toBe(false);
    expect(sameSecretTarget(at('https://shop.example.com:8443/a'), stored)).toBe(false);
    expect(sameSecretTarget(at('https://shop.example.com/a', { kind: 'bearer' }), stored)).toBe(
      false,
    );
    expect(
      sameSecretTarget(at('https://shop.example.com/a', { ...key, headerName: 'X-Leak' }), stored),
    ).toBe(false);
  });

  it('refuses a placeholder host even when both templates match', () => {
    expect(sameSecretTarget(at('https://{h}/a'), at('https://{h}/a'))).toBe(false);
    expect(sameSecretTarget(at('not a url'), at('not a url'))).toBe(false);
  });
});
