import { describe, expect, it } from 'vitest';

import { ActionDto, ActionInput, ActionTestRequest, UpdateActionRequest } from './index.js';

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
