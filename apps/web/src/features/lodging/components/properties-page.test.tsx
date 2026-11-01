import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LODGING_IDS,
  propertyFixture,
  stubLodgingApi,
  summaryFixture,
  unitFixture,
} from '@/testing/lodging-factories';
import { renderWithRouter } from '@/testing/render';

import { PropertiesPage } from './properties-page';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
vi.mock('@/lib/permissions', () => ({ useCan: () => true }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const a17 = summaryFixture({ today: 'occupied' });
const h1 = summaryFixture({
  id: LODGING_IDS.h1,
  code: 'H1',
  name: 'Homestay Hoa Sứ',
  sellMode: 'rooms',
  standardAdults: 4,
  standardChildren: 2,
  units: [
    unitFixture({ id: LODGING_IDS.r1, kind: 'room', name: 'P101', active: false }),
    unitFixture({ id: LODGING_IDS.r2, kind: 'room', name: 'P102', active: false }),
  ],
});

function stub() {
  const { fetchStub, calls } = stubLodgingApi({
    'GET /lodging/properties': { status: 200, body: { data: [a17, h1] } },
    'GET /lodging/calendar': {
      status: 200,
      body: { from: '2026-11-01', to: '2026-11-08', today: '2026-11-01', properties: [] },
    },
    'POST /lodging/properties': {
      status: 201,
      body: propertyFixture({ id: LODGING_IDS.h1, code: 'B2', name: 'Villa B2' }),
    },
  });
  vi.stubGlobal('fetch', fetchStub);
  return calls;
}

describe('PropertiesPage', () => {
  it('shows each place with its sell mode, capacity and today state', async () => {
    stub();
    renderWithRouter(() => <PropertiesPage />);
    const a17Card = await screen.findByRole('article', { name: /A17/ });
    expect(within(a17Card).getByText('Nguyên căn')).toBeInTheDocument();
    expect(within(a17Card).getByText('24 NL + 8 TE')).toBeInTheDocument();
    expect(within(a17Card).getByText('Đang có khách')).toBeInTheDocument();
    const h1Card = screen.getByRole('article', { name: /H1/ });
    expect(within(h1Card).getByText('Theo phòng')).toBeInTheDocument();
    expect(
      within(h1Card).getByText(/Bot chưa thấy căn này cho tới khi đủ giá/),
    ).toBeInTheDocument();
    expect(within(a17Card).queryByText(/Bot chưa thấy căn này/)).toBeNull();
    expect(document.body).not.toHaveTextContent(/sản phẩm/i);
  });

  it('creates a place from the dialog', async () => {
    const calls = stub();
    renderWithRouter(() => <PropertiesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Thêm căn' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Mã căn'), 'B2');
    await userEvent.type(within(dialog).getByLabelText('Tên căn'), 'Villa B2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tạo căn' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /lodging/properties')?.body).toMatchObject({
        code: 'B2',
        name: 'Villa B2',
        sellMode: 'whole',
        standardAdults: 2,
        standardChildren: 0,
      }),
    );
  });
});
