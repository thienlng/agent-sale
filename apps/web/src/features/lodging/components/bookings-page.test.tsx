import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { bookingFixture, LODGING_IDS, stubLodgingApi } from '@/testing/lodging-factories';
import { renderWithRouter } from '@/testing/render';

import { BookingsPage } from './bookings-page';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
const can = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/permissions', () => ({ useCan: () => can.value }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  can.value = true;
});

const later = bookingFixture({
  id: LODGING_IDS.bk1,
  code: 'BK-0011',
  status: 'hold',
  guestName: 'Chị Lan',
  holdExpiresAt: '2099-11-01T09:00:00.000Z',
});
const overdue = bookingFixture({
  id: LODGING_IDS.bk2,
  code: 'BK-0012',
  status: 'hold',
  guestName: 'Anh Bình',
  holdExpiresAt: '2020-01-01T03:00:00.000Z',
});
const sooner = bookingFixture({
  id: LODGING_IDS.bk3,
  code: 'BK-0013',
  status: 'hold',
  guestName: 'Cô Hoa',
  holdExpiresAt: '2099-11-01T02:00:00.000Z',
});

function stub() {
  const { fetchStub, calls } = stubLodgingApi({
    'GET /lodging/bookings': {
      status: 200,
      body: { data: [later, overdue, sooner], nextOffset: null },
    },
    'GET /lodging/properties': { status: 200, body: { data: [] } },
    'GET /lodging/settings': { status: 200, body: { holdMinutes: 120 } },
    'PATCH /lodging/settings': { status: 200, body: { holdMinutes: 30 } },
    'GET /lodging/bookings/review-count': { status: 200, body: { pending: 0 } },
  });
  vi.stubGlobal('fetch', fetchStub);
  return calls;
}

function renderPage() {
  return renderWithRouter(() => (
    <TooltipProvider>
      <BookingsPage />
    </TooltipProvider>
  ));
}

describe('BookingsPage', () => {
  it('lists holds by expiry and marks the overdue one', async () => {
    const calls = stub();
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: 'Giữ chỗ' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.startsWith('/lodging/bookings?view=holds'))).toBe(true),
    );
    const table = await screen.findByRole('table');
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(4));
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getByText(/^BK-/).textContent)).toEqual([
      'BK-0012',
      'BK-0013',
      'BK-0011',
    ]);
    expect(within(rows[0] as HTMLElement).getByText('Quá hạn')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).queryByText('Quá hạn')).toBeNull();
  });

  it('opens the shared booking sheet from a row', async () => {
    stub();
    vi.stubGlobal(
      'fetch',
      stubLodgingApi({
        'GET /lodging/bookings': { status: 200, body: { data: [later], nextOffset: null } },
        'GET /lodging/properties': { status: 200, body: { data: [] } },
        'GET /lodging/settings': { status: 200, body: { holdMinutes: 120 } },
        'GET /lodging/bookings/review-count': { status: 200, body: { pending: 0 } },
        [`GET /lodging/bookings/${LODGING_IDS.bk1}`]: {
          status: 200,
          body: { ...later, history: [] },
        },
      }).fetchStub,
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /BK-0011/ }));
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByText('BK-0011')).toBeInTheDocument();
  });

  it('saves the hold expiry minutes for catalog managers only', async () => {
    const calls = stub();
    const view = renderPage();
    const minutes = await screen.findByLabelText('Giữ chỗ tự hết hạn sau');
    await waitFor(() => expect(minutes).toHaveValue(120));
    await userEvent.clear(minutes);
    await userEvent.type(minutes, '30');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thời gian giữ' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /lodging/settings')?.body).toEqual({
        holdMinutes: 30,
      }),
    );
    view.unmount();
    can.value = false;
    renderPage();
    await screen.findByRole('tab', { name: 'Giữ chỗ' });
    expect(screen.queryByLabelText('Giữ chỗ tự hết hạn sau')).toBeNull();
  });
});

describe('BookingsPage tags', () => {
  it('shows tag chips and filters the list by a tag', async () => {
    const tagged = bookingFixture({
      id: LODGING_IDS.bk1,
      code: 'BK-0021',
      status: 'confirmed',
      guestName: 'Chị Lan',
      holdExpiresAt: null,
      tags: ['Đoàn công ty', 'Đã cọc'],
    });
    const { fetchStub, calls } = stubLodgingApi({
      'GET /lodging/bookings': { status: 200, body: { data: [tagged], nextOffset: null } },
      'GET /lodging/properties': { status: 200, body: { data: [] } },
      'GET /lodging/settings': { status: 200, body: { holdMinutes: 120 } },
      'GET /lodging/bookings/review-count': { status: 200, body: { pending: 0 } },
    });
    vi.stubGlobal('fetch', fetchStub);
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByRole('button', { name: /BK-0021/ })).closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('Đoàn công ty')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('Đã cọc')).toBeInTheDocument();
    screen.getByRole('combobox', { name: 'Nhãn' }).focus();
    await user.keyboard('{ArrowDown}');
    (await screen.findByRole('option', { name: 'Đoàn công ty' })).focus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.key === 'GET /lodging/bookings' &&
            new URLSearchParams(c.url.split('?')[1]).get('tag') === 'Đoàn công ty',
        ),
      ).toBe(true),
    );
  });

  it('merges an NFD "Đã cọc" with the NFC suggestion and filters by the NFC tag', async () => {
    const nfc = 'Đã cọc'.normalize('NFC');
    const tagged = bookingFixture({
      id: LODGING_IDS.bk1,
      code: 'BK-0021',
      status: 'confirmed',
      guestName: 'Chị Lan',
      holdExpiresAt: null,
      tags: [nfc.normalize('NFD')],
    });
    const { fetchStub, calls } = stubLodgingApi({
      'GET /lodging/bookings': { status: 200, body: { data: [tagged], nextOffset: null } },
      'GET /lodging/properties': { status: 200, body: { data: [] } },
      'GET /lodging/settings': { status: 200, body: { holdMinutes: 120 } },
      'GET /lodging/bookings/review-count': { status: 200, body: { pending: 0 } },
    });
    vi.stubGlobal('fetch', fetchStub);
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByRole('button', { name: /BK-0021/ })).closest('tr');
    screen.getByRole('combobox', { name: 'Nhãn' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(await screen.findAllByRole('option', { name: nfc })).toHaveLength(1);
    await user.keyboard('{Escape}');
    await user.click(
      within(row as HTMLElement).getByRole('button', { name: nfc.normalize('NFD') }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.key === 'GET /lodging/bookings' &&
            new URLSearchParams(c.url.split('?')[1]).get('tag') === nfc,
        ),
      ).toBe(true),
    );
  });
});

describe('BookingsPage bot holds', () => {
  const botHold = bookingFixture({
    id: LODGING_IDS.bk1,
    code: 'BK-0031',
    status: 'hold',
    guestName: 'Anh Nam',
    source: 'bot',
    conversationId: LODGING_IDS.conv,
    holdExpiresAt: '2099-11-01T09:00:00.000Z',
  });
  const staffHold = bookingFixture({
    id: LODGING_IDS.bk2,
    code: 'BK-0032',
    status: 'hold',
    guestName: 'Chị Lan',
    source: 'phone',
    holdExpiresAt: '2099-11-01T10:00:00.000Z',
  });

  function stubBot(pending: number) {
    const { fetchStub, calls } = stubLodgingApi({
      'GET /lodging/bookings': {
        status: 200,
        body: { data: [botHold, staffHold], nextOffset: null },
      },
      'GET /lodging/properties': { status: 200, body: { data: [] } },
      'GET /lodging/settings': { status: 200, body: { holdMinutes: 120 } },
      'GET /lodging/bookings/review-count': { status: 200, body: { pending } },
    });
    vi.stubGlobal('fetch', fetchStub);
    return calls;
  }

  it('marks bot bookings with "Bot tạo" and no other row', async () => {
    stubBot(1);
    renderPage();
    const botRow = (await screen.findByRole('button', { name: /BK-0031/ })).closest('tr');
    const staffRow = screen.getByRole('button', { name: /BK-0032/ }).closest('tr');
    expect(within(botRow as HTMLElement).getByText('Bot tạo')).toBeInTheDocument();
    expect(within(staffRow as HTMLElement).queryByText('Bot tạo')).toBeNull();
  });

  it('styles the badge of a reviewed bot hold as handled, a pending one as waiting', async () => {
    const reviewed = {
      ...botHold,
      id: LODGING_IDS.bk2,
      code: 'BK-0033',
      reviewedAt: '2099-10-31T00:00:00.000Z',
    };
    const { fetchStub } = stubLodgingApi({
      'GET /lodging/bookings': {
        status: 200,
        body: { data: [botHold, reviewed], nextOffset: null },
      },
      'GET /lodging/properties': { status: 200, body: { data: [] } },
      'GET /lodging/settings': { status: 200, body: { holdMinutes: 120 } },
      'GET /lodging/bookings/review-count': { status: 200, body: { pending: 1 } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderPage();
    const badge = (code: string) =>
      within(
        screen.getByRole('button', { name: new RegExp(code) }).closest('tr') as HTMLElement,
      ).getByText('Bot tạo');
    await screen.findByRole('button', { name: /BK-0033/ });
    expect(badge('BK-0031')).toHaveClass('bg-warning-soft');
    expect(badge('BK-0033')).not.toHaveClass('bg-warning-soft');
    expect(badge('BK-0033')).toHaveClass('text-muted-foreground');
  });

  it('shows how many bot holds wait for staff on the Giữ chỗ tab', async () => {
    stubBot(2);
    renderPage();
    const tab = await screen.findByRole('tab', { name: /^Giữ chỗ/ });
    await waitFor(() => expect(tab).toHaveAccessibleName('Giữ chỗ 2 giữ chỗ của bot chờ xử lý'));
  });

  it('shows no count on the tab when nothing waits', async () => {
    stubBot(0);
    renderPage();
    await screen.findByRole('button', { name: /BK-0031/ });
    expect(screen.getByRole('tab', { name: 'Giữ chỗ' })).toBeInTheDocument();
  });

  it('filters the list to bookings made by the bot', async () => {
    const calls = stubBot(1);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: /BK-0031/ });
    screen.getByRole('combobox', { name: 'Nguồn' }).focus();
    await user.keyboard('{ArrowDown}');
    (await screen.findByRole('option', { name: 'Bot' })).focus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.key === 'GET /lodging/bookings' &&
            new URLSearchParams(c.url.split('?')[1]).get('source') === 'bot',
        ),
      ).toBe(true),
    );
  });

  it('shows each hold as a card with its dates and expiry on a phone (VL-A10)', async () => {
    stub();
    vi.stubGlobal('innerWidth', 390);
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: 'Giữ chỗ' }));
    const card = await screen.findByRole('button', { name: /BK-0011/ });
    expect(screen.queryByRole('table')).toBeNull();
    expect(card).toHaveTextContent('Chị Lan');
    expect(card).toHaveTextContent('→');
    expect(card).toHaveTextContent(/giữ đến \d{2}:\d{2} 01\/11\/2099/);
  });

  it('shows the "Chat thử" chip of a test hold on a phone card (VL2-9)', async () => {
    const { fetchStub } = stubLodgingApi({
      'GET /lodging/bookings': {
        status: 200,
        body: {
          data: [{ ...later, source: 'bot', reviewedAt: null, tags: ['Chat thử'] }],
          nextOffset: null,
        },
      },
      'GET /lodging/properties': { status: 200, body: { data: [] } },
      'GET /lodging/settings': { status: 200, body: { holdMinutes: 120 } },
      'GET /lodging/bookings/review-count': { status: 200, body: { pending: 0 } },
    });
    vi.stubGlobal('fetch', fetchStub);
    vi.stubGlobal('innerWidth', 390);
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: 'Giữ chỗ' }));
    const card = await screen.findByRole('button', { name: /BK-0011/ });
    expect(card).toHaveTextContent('Chat thử');
    // A live hold reads "giữ đến", never in red.
    expect(within(card).getByText(/giữ đến/)).not.toHaveClass('text-destructive');
  });
});
