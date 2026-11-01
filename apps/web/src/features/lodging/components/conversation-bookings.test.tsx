import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { bookingFixture, LODGING_IDS, stubLodgingApi } from '@/testing/lodging-factories';
import { renderWithRouter } from '@/testing/render';

import { ConversationBookings } from './conversation-bookings';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
vi.mock('@/lib/permissions', () => ({ useCan: () => true }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const hold = bookingFixture({
  code: 'BK-0021',
  status: 'hold',
  conversationId: LODGING_IDS.conv,
  holdExpiresAt: '2099-11-01T09:00:00.000Z',
});

describe('ConversationBookings', () => {
  it("lists the conversation's bookings and opens a prefilled booking sheet", async () => {
    const { fetchStub, calls } = stubLodgingApi({
      'GET /lodging/bookings': { status: 200, body: { data: [hold], nextOffset: null } },
      'GET /lodging/properties': { status: 200, body: { data: [] } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => (
      <TooltipProvider>
        <ConversationBookings
          conversationId={LODGING_IDS.conv}
          contactId={LODGING_IDS.contact}
          guestName="Chị Mai"
          guestPhone="0987654321"
          source="messenger"
        />
      </TooltipProvider>
    ));
    expect(await screen.findByText('BK-0021')).toBeInTheDocument();
    expect(screen.getByText('Giữ chỗ')).toBeInTheDocument();
    expect(calls[0]?.url).toBe(`/lodging/bookings?view=all&conversationId=${LODGING_IDS.conv}`);
    expect(screen.queryByText(/Yêu cầu đặt căn/)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Tạo booking' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByLabelText('Tên khách')).toHaveValue('Chị Mai');
    expect(within(sheet).getByLabelText('Số điện thoại')).toHaveValue('0987654321');
    await waitFor(() => expect(within(sheet).getByLabelText('Nhận phòng')).toHaveValue(''));
  });
});
