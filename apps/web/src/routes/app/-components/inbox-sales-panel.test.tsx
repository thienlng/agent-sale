import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PanelSlots } from '@/features/conversation/components/conversation-view';
import type { InboxConversation } from '@/features/conversation/lib/inbox-v2-types';
import { renderWithRouter } from '@/testing/render';

import { InboxSalesPanel } from './inbox-sales-panel';

const CONTACT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a01';
const state = vi.hoisted(() => ({ industry: 'spa' }));

vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
vi.mock('@/lib/permissions', () => ({ useCan: () => true }));
vi.mock('@/features/workspace/api/use-current-workspace', () => ({
  useCurrentWorkspace: () => ({ data: { industry: state.industry } }),
}));
vi.mock('@/features/crm/api/crm', () => ({
  useContact: () => ({
    data: {
      id: CONTACT,
      name: 'Chị Lan',
      phone: null,
      email: null,
      address: null,
      profileNote: '',
    },
    isError: false,
    refetch: vi.fn(),
  }),
  useContacts: () => ({ data: { data: [] }, isPending: false, isError: false }),
}));
vi.mock('@/features/crm/hooks/use-crm-lookups', () => ({ useCrmLookups: () => ({}) }));
vi.mock('@/features/crm/components/contact-sheet', () => ({ ContactSheet: () => null }));
vi.mock('@/features/crm/components/customer-requests-card', () => ({
  CustomerRequestsCard: ({ contactId, industry }: { contactId: string; industry: string }) => (
    <p>
      requests of {contactId} ({industry})
    </p>
  ),
}));
vi.mock('@/features/conversation/api/inbox', () => ({
  useSetConversationContact: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/features/conversation/components/customer-panel', () => ({
  CustomerSummary: () => null,
  FollowUpBlock: () => null,
}));
vi.mock('@/features/conversation/components/notes-block', () => ({ NotesBlock: () => null }));
vi.mock('./inbox-contact-controls', () => ({ InboxContactControls: () => null }));
vi.mock('./contact-conversations', () => ({ ContactConversations: () => null }));

const conversation = {
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9b01',
  provider: 'facebook',
  customerName: 'Chị Lan',
  customerPhone: null,
  contactId: CONTACT,
} as unknown as InboxConversation;
const slots: PanelSlots = { tags: null, media: null };

function renderPanel() {
  renderWithRouter(() => (
    <InboxSalesPanel
      conversation={conversation}
      slots={slots}
      value={{ orders: [] }}
      onChange={vi.fn()}
      onOrderCreated={vi.fn()}
    />
  ));
}

beforeEach(() => {
  state.industry = 'spa';
});

describe('InboxSalesPanel', () => {
  it.each(['spa', 'education'])(
    'shows the customer requests instead of orders in a %s business',
    async (industry) => {
      state.industry = industry;
      renderPanel();
      expect(await screen.findByText(`requests of ${CONTACT} (${industry})`)).toBeVisible();
      expect(screen.queryByRole('region', { name: 'Đơn hàng' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Tạo đơn' })).toBeNull();
    },
  );

  it('keeps the orders block in a shop', async () => {
    state.industry = 'retail';
    renderPanel();
    expect(await screen.findByRole('button', { name: 'Tạo đơn' })).toBeVisible();
    expect(screen.queryByText(/requests of/)).toBeNull();
  });
});
