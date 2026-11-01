import { type SyncLogEntry, SyncLogParams } from '@agent-sales/contracts';
import { integration } from '@agent-sales/i18n/integration';
import { screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { renderWithProviders } from '@/testing/render';

import { SyncLogList } from './sync-log-list';

beforeAll(() => loadNamespace('integration'));
const at = new Date().toISOString();
let seq = 0;
const entry = (
  code: string,
  params: SyncLogEntry['params'] = {},
  level: SyncLogEntry['level'] = 'info',
) => ({
  id: `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9b${String((seq += 1)).padStart(2, '0')}`,
  level,
  code,
  params,
  at,
});

describe('SyncLogList', () => {
  it('translates log codes with their params', () => {
    renderWithProviders(
      <SyncLogList
        loading={false}
        failed={false}
        entries={[
          // The params the backend logs (`SyncLogParams`), not just the ones the copy uses.
          entry('connected', {
            retailer: 'shopabc',
            branches: 2,
          } satisfies SyncLogParams['connected']),
          entry('image_failed', { count: 3 }, 'warning'),
          entry('sku_conflict', { sku: 'SP001' }, 'warning'),
          entry('auth_failed', {}, 'error'),
          entry('order_pushed', { code: 'DH0012' } satisfies SyncLogParams['order_pushed']),
          entry(
            'order_push_failed',
            {
              code: 'DH0013',
              reason: 'kiotviet_rejected',
            } satisfies SyncLogParams['order_push_failed'],
            'warning',
          ),
          entry(
            'order_pushed_cancelled',
            { code: 'DH0014' } satisfies SyncLogParams['order_pushed_cancelled'],
            'warning',
          ),
        ]}
      />,
    );
    expect(screen.getByText('Đã kết nối gian hàng shopabc')).toBeInTheDocument();
    expect(screen.getByText('3 ảnh không tải được (chỉ nhận JPEG/PNG)')).toBeInTheDocument();
    expect(screen.getByText(/Mã SP001 trùng với một sản phẩm khác/)).toBeInTheDocument();
    expect(screen.getByText(/KiotViet từ chối mã bảo mật/)).toBeInTheDocument();
    expect(screen.getByText('Đã đẩy đơn DH0012 sang KiotViet')).toBeInTheDocument();
    expect(screen.getByText(/Chưa đẩy được đơn DH0013 sang KiotViet/)).toBeInTheDocument();
    expect(screen.getByText(/Đơn DH0014 đã huỷ trên Rapiz/)).toBeInTheDocument();
    expect(screen.getAllByText('Cảnh báo:')).toHaveLength(4);
  });

  it('every log copy uses only params its code carries, and every code has copy', () => {
    for (const messages of [integration.vi.log, integration.en.log] as Array<
      Record<string, unknown>
    >) {
      for (const [code, schema] of Object.entries(SyncLogParams)) {
        const copy = messages[code];
        expect(typeof copy, `log.${code}`).toBe('string');
        const used = [...String(copy).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
        const known = Object.keys(schema.shape);
        for (const name of used) expect(known, `log.${code} uses {{${name}}}`).toContain(name);
      }
    }
  });

  it('shows a generic line for an unknown code instead of failing', () => {
    renderWithProviders(
      <SyncLogList loading={false} failed={false} entries={[entry('brand_new_code', { x: 1 })]} />,
    );
    expect(screen.getByText('Sự kiện đồng bộ khác')).toBeInTheDocument();
  });

  it('has empty and loading states', () => {
    const { rerender } = renderWithProviders(
      <SyncLogList loading={false} failed={false} entries={[]} />,
    );
    expect(screen.getByText('Chưa có hoạt động nào.')).toBeInTheDocument();
    rerender(<SyncLogList loading failed={false} entries={undefined} />);
    expect(screen.queryByText('Chưa có hoạt động nào.')).toBeNull();
  });
});
