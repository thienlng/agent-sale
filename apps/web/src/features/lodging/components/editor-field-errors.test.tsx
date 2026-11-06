import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LODGING_IDS,
  propertyFixture,
  stubLodgingApi,
  unitFixture,
  weekdayRate,
} from '@/testing/lodging-factories';
import { renderWithRouter } from '@/testing/render';

import { OverrideDialog } from './override-dialog';
import { UnitInfoTab } from './unit-info-tab';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const describedText = (input: HTMLElement) =>
  document.getElementById(input.getAttribute('aria-describedby') ?? '')?.textContent;

describe('editor field errors', () => {
  it('puts override errors under the offending fields', async () => {
    const { fetchStub, calls } = stubLodgingApi({});
    vi.stubGlobal('fetch', fetchStub);
    const p = propertyFixture({
      rates: [
        weekdayRate({
          id: '0193a000-0000-7000-8000-000000000601',
          kind: 'override',
          weekdays: [],
          dateFrom: '2027-02-05',
          dateTo: '2027-02-10',
          label: 'Tết',
        }),
      ],
    });
    renderWithRouter(() => <OverrideDialog property={p} rate={null} onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    const label = within(dialog).getByLabelText('Tên');
    expect(label).toHaveAttribute('aria-invalid', 'true');
    expect(describedText(label)).toBe('Bắt buộc');
    expect(describedText(within(dialog).getByLabelText('Giá bán'))).toBe('Bắt buộc');

    await userEvent.type(label, 'Tết 2027');
    await userEvent.type(within(dialog).getByLabelText('Từ đêm'), '2027-02-08');
    await userEvent.type(within(dialog).getByLabelText('Đến đêm (gồm cả đêm này)'), '2027-02-12');
    await userEvent.type(within(dialog).getByLabelText('Giá bán'), '20000000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(describedText(within(dialog).getByLabelText('Đến đêm (gồm cả đêm này)'))).toBe(
      'Khoảng ngày trùng với ngày đặc biệt khác.',
    );
    expect(calls).toHaveLength(0);
  });

  it('puts unit errors under the unit fields', async () => {
    const { fetchStub, calls } = stubLodgingApi({});
    vi.stubGlobal('fetch', fetchStub);
    const room = unitFixture({ id: LODGING_IDS.r1, kind: 'room', name: 'P101' });
    const p = propertyFixture({ id: LODGING_IDS.h1, sellMode: 'rooms', units: [room] });
    renderWithRouter(() => (
      <UnitInfoTab property={p} unit={room} canEdit onDirtyChange={() => {}} />
    ));
    const name = await screen.findByLabelText('Tên');
    await userEvent.clear(name);
    const adults = screen.getByLabelText('Người lớn tiêu chuẩn');
    await userEvent.clear(adults);
    await userEvent.type(adults, '0');
    const area = screen.getByLabelText('Diện tích (m²)');
    await userEvent.type(area, '0');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thông tin' }));
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(describedText(name)).toBe('Nhập tên đơn vị.');
    expect(describedText(adults)).toBe('Người lớn tiêu chuẩn từ 1 đến 100.');
    expect(describedText(area)).toBe('Diện tích từ 1 đến 100000 m², hoặc để trống.');
    expect(calls).toHaveLength(0);
  });
});
