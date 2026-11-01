import type { SyncLogEntry } from '@agent-sales/contracts';
import { screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { renderWithProviders } from '@/testing/render';

import { SyncLogList } from './sync-log-list';

beforeAll(() => loadNamespace('integration'));
const at = new Date().toISOString();
const entry = (
  code: string,
  params: SyncLogEntry['params'] = {},
  level: SyncLogEntry['level'] = 'info',
) => ({
  id: `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9b${String(code.length).padStart(2, '0')}`,
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
          entry('connected', { retailer: 'shopabc' }),
          entry('image_failed', { count: 3 }, 'warning'),
          entry('sku_conflict', { sku: 'SP001' }, 'warning'),
          entry('auth_failed', {}, 'error'),
        ]}
      />,
    );
    expect(screen.getByText('Đã kết nối gian hàng shopabc')).toBeInTheDocument();
    expect(screen.getByText('3 ảnh không tải được (chỉ nhận JPEG/PNG)')).toBeInTheDocument();
    expect(screen.getByText(/Mã SP001 trùng với một sản phẩm khác/)).toBeInTheDocument();
    expect(screen.getByText(/KiotViet từ chối mã bảo mật/)).toBeInTheDocument();
    expect(screen.getAllByText('Cảnh báo:')).toHaveLength(2);
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
