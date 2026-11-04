import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/testing/render';

import type { CrmLookups } from '../hooks/use-crm-lookups';
import { ContactHistoryTab } from './contact-history';

const entry = (changes: Record<string, { from: unknown; to: unknown }>, id: string) => ({
  id,
  type: 'contact.updated',
  changes,
  data: {},
  actorName: null,
  at: '2026-11-04T08:00:00.000Z',
});
vi.mock('../api/crm', () => ({
  useHistory: () => ({
    isPending: false,
    data: [
      entry({ lead: { from: null, to: 'bot' } }, '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d31'),
      entry({ nickname: { from: null, to: 'Lan' } }, '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d32'),
    ],
  }),
}));

describe('ContactHistoryTab', () => {
  it('names a captured lead and never shows a raw i18n key', () => {
    renderWithProviders(
      <ContactHistoryTab contactId="c-1" lookups={{} as CrmLookups} industry="education" />,
    );
    expect(screen.getByText('Ghi nhận từ:')).toBeVisible();
    expect(screen.getByText('nickname:')).toBeVisible();
    expect(screen.queryByText(/crm\.col\./)).toBeNull();
  });
});
