import type { ContactDto } from '@agent-sales/contracts';
import { screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { renderWithProviders, stubFetch } from '@/testing/render';

import type { CrmLookups } from '../hooks/use-crm-lookups';
import { ContactFields, draftOf } from './contact-form';
import { ContactsList } from './contacts-list';

// The CRM routes load the `integration` namespace, which carries the KiotViet strings (bundle budget).
beforeAll(() => loadNamespace('integration'));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => vi.unstubAllGlobals());

const contact = (linked: boolean, name = 'Chị Lan'): ContactDto => ({
  id: linked ? '7f8f6d1e-0d1a-4a8c-9a59-0c7bd4b6a001' : '7f8f6d1e-0d1a-4a8c-9a59-0c7bd4b6a002',
  name,
  phone: '0912000001',
  phoneNormalized: '+84912000001',
  email: null,
  birthday: null,
  gender: null,
  address: null,
  province: null,
  ward: null,
  phoneProvidedAt: null,
  addressProvidedAt: null,
  sourceId: null,
  firstSourceId: null,
  statusId: null,
  salesUserId: null,
  careUserId: null,
  adRef: null,
  profileNote: '',
  tags: [],
  external: linked ? { source: 'kiotviet', id: '5001' } : null,
  version: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
});

const lookups: CrmLookups = {
  sources: [],
  statuses: [],
  tags: [],
  assignees: [],
  bots: [],
  source: () => undefined,
  status: () => undefined,
  tag: () => undefined,
  member: () => undefined,
};

function renderList() {
  const empty = { status: 200, body: { data: [] } };
  const { fetchStub } = stubFetch({
    'POST /contacts/query': {
      status: 200,
      body: {
        data: [contact(true), contact(false, 'Anh Minh')],
        total: 2,
        page: 1,
        pageSize: 20,
      },
    },
    'GET /crm/sources': empty,
    'GET /crm/statuses': empty,
    'GET /crm/tags': empty,
    'GET /crm/assignees': empty,
    'GET /bots': empty,
    'GET /saved-views': empty,
  });
  vi.stubGlobal('fetch', fetchStub);
  renderWithProviders(<ContactsList search={{}} onSearch={() => {}} />);
}

/** The table row (desktop) of a customer; jsdom renders the phone cards too. */
async function row(name: string) {
  const button = (await screen.findAllByRole('button', { name })).find((b) => b.closest('tr'));
  return button?.closest('tr') as HTMLElement;
}

const HINT = 'Đồng bộ từ KiotViet — sửa trên KiotViet để giữ thay đổi';

describe('KiotViet customers in the CRM', () => {
  it('marks only the linked customer in the list with a KiotViet badge', async () => {
    renderList();
    expect(within(await row('Chị Lan')).getByText('KiotViet')).toBeInTheDocument();
    expect(within(await row('Anh Minh')).queryByText('KiotViet')).toBeNull();
    // The phone cards carry it too.
    expect(screen.getAllByText('KiotViet')).toHaveLength(2);
  });

  it('hints the KiotViet-owned fields of a linked customer and keeps them editable', () => {
    const c = contact(true);
    renderWithProviders(
      <ContactFields
        idPrefix="t"
        value={draftOf(c)}
        onChange={() => {}}
        lookups={lookups}
        synced
      />,
    );
    expect(screen.getByText(HINT)).toBeInTheDocument();
    for (const label of ['Họ và tên', 'Số điện thoại', 'Email', 'Ngày sinh', 'Địa chỉ']) {
      const field = screen.getByLabelText(label, { selector: 'input' });
      expect(field).toHaveAccessibleDescription(HINT);
      expect(field).toBeEnabled();
    }
    expect(screen.getByRole('combobox', { name: /Giới tính/ })).toHaveAccessibleDescription(HINT);
    // Rapiz-only fields carry no hint.
    expect(screen.getByLabelText('Tỉnh / thành phố')).not.toHaveAccessibleDescription(HINT);
  });

  it('shows no hint for a Rapiz-only customer', () => {
    const c = contact(false);
    renderWithProviders(
      <ContactFields idPrefix="t" value={draftOf(c)} onChange={() => {}} lookups={lookups} />,
    );
    expect(screen.queryByText(HINT)).toBeNull();
  });
});
