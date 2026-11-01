import { beforeAll, describe, expect, it } from 'vitest';

import { ApiClientError } from '@/lib/api-client';
import { i18n, loadNamespace } from '@/lib/i18n';

import { describeFailure, missingCredentials } from './errors';

beforeAll(() => loadNamespace('integration'));
const t = i18n.getFixedT('vi', 'integration');
const bad = (reason: string, extra: Record<string, unknown> = {}) =>
  new ApiClientError(400, 'VALIDATION_FAILED', 'x', undefined, { reason, ...extra });

describe('describeFailure', () => {
  it('puts a credential rejection under Client ID and the secret', () => {
    const f = describeFailure(t, bad('kiotviet_auth'));
    expect(f.fields.clientId).toContain('Client ID hoặc mã bảo mật không đúng');
    expect(f.fields.clientSecret).toBe(f.fields.clientId);
    expect(f.banner).toBeNull();
  });

  it('puts an unknown store and a store change under the store name', () => {
    expect(describeFailure(t, bad('kiotviet_retailer')).fields.retailer).toContain(
      'Không tìm thấy gian hàng',
    );
    expect(describeFailure(t, bad('kiotviet_retailer_changed')).fields.retailer).toContain(
      'Mã mới thuộc gian hàng khác',
    );
  });

  it('lists missing permissions in a banner, translating known names', () => {
    const f = describeFailure(t, bad('kiotviet_permission', { missing: ['customers', 'odd'] }));
    expect(f.banner).toBe(
      'Tài khoản API chưa được cấp quyền: khách hàng, odd. Tick các quyền này trong KiotViet rồi thử lại.',
    );
  });

  it('flags vanished branches, busy KiotViet and conflicts', () => {
    expect(describeFailure(t, bad('kiotviet_branch')).branches).toContain(
      'Chi nhánh không còn trên KiotViet',
    );
    expect(describeFailure(t, new ApiClientError(503, 'UNAVAILABLE', 'down')).banner).toBe(
      'KiotViet đang bận, thử lại sau một phút.',
    );
    expect(describeFailure(t, new ApiClientError(409, 'CONFLICT', 'x')).conflict).toBe(true);
  });

  it('falls back to a generic message', () => {
    expect(describeFailure(t, new Error('boom')).banner).toBe('Có lỗi xảy ra. Thử lại sau.');
  });
});

describe('missingCredentials', () => {
  it('requires every field', () => {
    expect(missingCredentials(t, { retailer: ' ', clientId: 'a', clientSecret: '' })).toEqual({
      retailer: 'Nhập tên gian hàng.',
      clientSecret: 'Nhập mã bảo mật.',
    });
  });
});
