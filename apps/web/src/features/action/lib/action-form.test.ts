import { describe, expect, it } from 'vitest';

import {
  buildArgs,
  confirmDefault,
  emptyParam,
  newForm,
  toInput,
  validateForm,
  type ActionForm,
} from './action-form';

const valid = (over: Partial<ActionForm> = {}): ActionForm => ({
  ...newForm(),
  name: 'Tra cứu đơn',
  description: 'Khi khách hỏi đơn hàng',
  url: 'https://shop.vn/orders',
  ...over,
});

describe('validateForm', () => {
  it('accepts a minimal valid form', () => {
    expect(validateForm(valid())).toEqual({});
  });

  it('requires name, description and url', () => {
    const errors = validateForm(valid({ name: ' ', description: '', url: '' }));
    expect(errors['name']?.key).toBe('required');
    expect(errors['description']?.key).toBe('required');
    expect(errors['url']?.key).toBe('https');
  });

  it('rejects a non-HTTPS url', () => {
    expect(validateForm(valid({ url: 'http://shop.vn' }))['url']?.key).toBe('https');
  });

  it('requires a path param for every {placeholder}', () => {
    const errors = validateForm(valid({ url: 'https://shop.vn/orders/{orderId}' }));
    expect(errors['url']).toEqual({ key: 'placeholder', vars: { name: '{orderId}' } });
    const ok = validateForm(
      valid({
        url: 'https://shop.vn/orders/{orderId}',
        params: [{ ...emptyParam(), name: 'orderId', location: 'path', description: 'Mã đơn' }],
      }),
    );
    expect(ok).toEqual({});
  });

  it('flags duplicate param names on the later row', () => {
    const p = { ...emptyParam(), name: 'q', description: 'x' };
    const errors = validateForm(valid({ params: [p, { ...p, key: 'other' }] }));
    expect(errors['params.1.name']?.key).toBe('duplicate');
  });

  it('flags an invalid param name and a missing param description', () => {
    const errors = validateForm(valid({ params: [{ ...emptyParam(), name: '1bad' }] }));
    expect(errors['params.0.name']?.key).toBe('paramName');
    expect(errors['params.0.description']?.key).toBe('required');
  });

  it('flags a response status code out of range', () => {
    const errors = validateForm(
      valid({ responses: [{ key: 'a', statusCode: '999', fields: [] }] }),
    );
    expect(errors['responses.0.statusCode']?.key).toBe('statusCode');
  });

  it('requires the header name for API key auth', () => {
    expect(
      validateForm(valid({ authKind: 'api_key', headerName: '' }))['auth.headerName']?.key,
    ).toBe('headerName');
  });
});

describe('toInput', () => {
  it('omits the secret unless typed (absent keeps the saved one)', () => {
    const body = toInput(valid({ authKind: 'bearer', hasSecret: true, secret: '' })) as Record<
      string,
      unknown
    >;
    expect('authSecret' in body).toBe(false);
    const typed = toInput(valid({ authKind: 'bearer', secret: 's3' })) as Record<string, unknown>;
    expect(typed['authSecret']).toBe('s3');
  });

  it('clears a saved secret when authentication is switched off', () => {
    const body = toInput(valid({ authKind: 'none', hasSecret: true, secret: 'x' })) as Record<
      string,
      unknown
    >;
    expect(body['authSecret']).toBe('');
  });

  it('strips row keys', () => {
    const body = toInput(valid({ params: [emptyParam()] })) as {
      params: Record<string, unknown>[];
    };
    expect('key' in (body.params[0] ?? {})).toBe(false);
  });
});

describe('helpers', () => {
  it('asks for confirmation by default on writes only', () => {
    expect(confirmDefault('GET')).toBe(false);
    expect(confirmDefault('POST')).toBe(true);
    expect(confirmDefault('DELETE')).toBe(true);
  });

  it('builds typed sample args and skips blanks', () => {
    expect(
      buildArgs(
        [
          { name: 'id', type: 'string' },
          { name: 'qty', type: 'number' },
          { name: 'gift', type: 'boolean' },
          { name: 'note', type: 'string' },
        ],
        { id: ' A1 ', qty: '3', gift: 'true', note: '' },
      ),
    ).toEqual({ id: 'A1', qty: 3, gift: true });
  });
});
