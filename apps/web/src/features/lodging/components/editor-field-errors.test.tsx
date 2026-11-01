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
import { RoomsTab } from './rooms-tab';

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

  it('puts room errors under the room fields', async () => {
    const { fetchStub, calls } = stubLodgingApi({});
    vi.stubGlobal('fetch', fetchStub);
    const p = propertyFixture({
      id: LODGING_IDS.h1,
      sellMode: 'rooms',
      units: [unitFixture({ id: LODGING_IDS.r1, kind: 'room', name: 'P101' })],
    });
    renderWithRouter(() => <RoomsTab property={p} canEdit onDirtyChange={() => {}} />);
    const [name] = await screen.findAllByLabelText('Tên phòng');
    await userEvent.clear(name as HTMLElement);
    const [adults] = screen.getAllByLabelText('Người lớn');
    await userEvent.clear(adults as HTMLElement);
    await userEvent.type(adults as HTMLElement, '0');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu phòng' }));
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(describedText(name as HTMLElement)).toBe('Nhập tên phòng.');
    expect(describedText(adults as HTMLElement)).toBe('Ít nhất 1 người lớn.');
    expect(calls).toHaveLength(0);
  });
});
