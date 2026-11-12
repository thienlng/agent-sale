import { describe, expect, it } from 'vitest';

import {
  buildArgs,
  confirmDefault,
  emptyParam,
  formFromDto,
  newForm,
  toInput,
  validateForm,
  type ActionForm,
} from './action-form';
import { actionDto } from '../components/fixtures';

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

  it('flags duplicate names that differ only by case', () => {
    const p = { ...emptyParam(), name: 'Q', description: 'x' };
    const errors = validateForm(valid({ params: [p, { ...p, key: 'o', name: 'q' }] }));
    expect(errors['params.1.name']?.key).toBe('duplicate');
  });

  it('flags reserved and auth-colliding header params', () => {
    const header = (name: string) => ({
      ...emptyParam(),
      name,
      location: 'header' as const,
      description: 'x',
    });
    expect(validateForm(valid({ params: [header('Host')] }))['params.0.name']?.key).toBe(
      'reservedHeader',
    );
    const auth = valid({
      authKind: 'api_key',
      headerName: 'X-Api-Key',
      params: [header('x-api-key')],
    });
    expect(validateForm(auth)['params.0.name']?.key).toBe('reservedHeader');
  });

  it('flags a body param on GET', () => {
    const body = { ...emptyParam(), name: 'note', location: 'body' as const, description: 'x' };
    expect(validateForm(valid({ params: [body] }))['params.0.location']?.key).toBe('bodyOnGet');
    expect(validateForm(valid({ method: 'POST', params: [body] }))).toEqual({});
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

  it('sends source only for a param the server fills from the customer record', () => {
    const phone = {
      ...emptyParam(),
      name: 'phone',
      description: 'SĐT',
      source: 'customer_phone' as const,
    };
    const body = toInput(
      valid({ params: [{ ...emptyParam(), name: 'q', description: 'x' }, phone] }),
    ) as {
      params: Record<string, unknown>[];
    };
    expect('source' in (body.params[0] ?? {})).toBe(false);
    expect(body.params[1]?.['source']).toBe('customer_phone');
    expect(validateForm(valid({ params: [phone] }))).toEqual({});
  });

  it('flags a non-string param filled from the customer record', () => {
    const p = {
      ...emptyParam(),
      name: 'phone',
      description: 'x',
      type: 'number' as const,
      source: 'customer_phone' as const,
    };
    expect(validateForm(valid({ params: [p] }))['params.0.type']?.key).toBe('sourceType');
  });
});

describe('formFromDto', () => {
  it('reads a param saved without source as filled by the bot', () => {
    const form = formFromDto(actionDto());
    expect(form.params[0]?.source).toBe('model');
    const bound = formFromDto(
      actionDto({
        params: [
          {
            name: 'orderId',
            type: 'string',
            location: 'path',
            required: true,
            description: 'Mã đơn',
          },
          {
            name: 'phone',
            type: 'string',
            location: 'query',
            required: true,
            description: 'SĐT',
            source: 'customer_email',
          },
        ],
      }),
    );
    expect(bound.params[1]?.source).toBe('customer_email');
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
