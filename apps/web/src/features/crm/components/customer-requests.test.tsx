import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CrmLookups } from '../hooks/use-crm-lookups';
import { ContactHistoryTab } from './contact-history';
import { statusFilter } from './contacts-search';
import { CustomerRequestsCard } from './customer-requests-card';
import { balancedColumns, RequestSummaryStrip } from './request-summary-strip';

const mocks = vi.hoisted(() => ({
  can: { 'contacts.view_all': true } as Record<string, boolean>,
  requests: { data: [] as unknown[] } as unknown,
  pending: false,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/permissions', () => ({ useCan: (cap: string) => mocks.can[cap] ?? false }));

const CONTACT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d04';
const BOOKING_REQUESTED = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d11';
const BOOKED = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d12';
const appointment = {
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d21',
  contactId: CONTACT,
  kind: 'appointment',
  update: false,
  details: { name: 'Lan', service: 'Gội đầu dưỡng sinh', branch: 'Quận 3', preferredTime: '14h' },
  dateLabel: 'Thứ Bảy 08/11/2026',
  recordedAt: '2026-11-04T08:00:00.000Z',
};
vi.mock('../api/crm', () => ({
  useHistory: () => ({
    isPending: false,
    data: [
      {
        id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d31',
        type: 'contact.request_recorded',
        changes: {},
        data: {
          kind: 'placement_test',
          details: { course: 'IELTS 6.5', branch: 'Cơ sở Cầu Giấy' },
          dateLabel: 'Thứ Bảy 08/11/2026',
        },
        actorName: 'Bot AI',
        at: '2026-11-04T08:00:00.000Z',
      },
    ],
  }),
}));
vi.mock('../api/requests', () => ({
  useRequestSummary: () => ({
    data: {
      statuses: [
        {
          statusId: BOOKING_REQUESTED,
          key: 'booking_requested',
          name: 'Chờ xác nhận lịch',
          color: '#f97316',
          count: 3,
        },
        { statusId: BOOKED, key: 'booked', name: 'Đã đặt lịch', color: '#16a34a', count: 5 },
      ],
      open: [{ ...appointment, contactName: 'Lan', statusKey: 'booking_requested' }],
      recorded7d: 4,
    },
    isPending: false,
    isError: false,
  }),
  useContactRequests: () => ({
    data: mocks.requests,
    isPending: mocks.pending,
    isError: false,
  }),
}));

beforeEach(() => {
  mocks.can = { 'contacts.view_all': true };
  mocks.requests = { data: [] };
  mocks.pending = false;
});

describe('RequestSummaryStrip', () => {
  it('shows customers per status, and a click filters the list by that status', () => {
    const onStatus = vi.fn();
    render(<RequestSummaryStrip industry="spa" onStatus={onStatus} onOpenContact={vi.fn()} />);
    expect(screen.getByText('crm.requests.strip.recorded7d').parentElement).toHaveTextContent('4');
    const booked = screen.getByRole('button', { name: /Đã đặt lịch/ });
    expect(booked).toHaveTextContent('5');
    fireEvent.click(screen.getByRole('button', { name: /Chờ xác nhận lịch/ }));
    expect(onStatus).toHaveBeenCalledWith(BOOKING_REQUESTED);
    expect(statusFilter([BOOKING_REQUESTED])).toEqual({
      v: 1,
      match: 'all',
      rules: [{ field: 'statusId', op: 'in', value: [BOOKING_REQUESTED] }],
      duplicatesOnly: false,
    });
  });

  it('lists the open requests, and a click opens the customer', () => {
    const onOpenContact = vi.fn();
    render(<RequestSummaryStrip industry="spa" onStatus={vi.fn()} onOpenContact={onOpenContact} />);
    const open = screen.getByRole('button', { name: /crm.requests.strip.open/ });
    expect(open).toHaveTextContent('1');
    fireEvent.click(open);
    const row = screen.getByRole('button', { name: /Lan/ });
    expect(row).toHaveTextContent('crm.requests.kind.appointment');
    expect(row).toHaveTextContent('Gội đầu dưỡng sinh · Quận 3 · Thứ Bảy 08/11/2026, 14h');
    fireEvent.click(row);
    expect(onOpenContact).toHaveBeenCalledWith(CONTACT);
  });

  it('stays away from members without view_all', () => {
    mocks.can['contacts.view_all'] = false;
    const { container } = render(
      <RequestSummaryStrip industry="spa" onStatus={vi.fn()} onOpenContact={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('CustomerRequestsCard', () => {
  it('lists the requests with the day label and marks an update', () => {
    mocks.requests = {
      data: [
        appointment,
        {
          ...appointment,
          id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d22',
          kind: 'trial',
          update: true,
          details: { course: 'IELTS 6.5', branch: 'Online' },
          dateLabel: null,
        },
      ],
    };
    render(<CustomerRequestsCard contactId={CONTACT} industry="education" />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('crm.requests.kind.appointment');
    expect(items[0]).toHaveTextContent('Thứ Bảy 08/11/2026');
    expect(items[0]).not.toHaveTextContent('crm.requests.card.updated');
    expect(items[1]).toHaveTextContent('crm.requests.kind.trial');
    expect(items[1]).toHaveTextContent('IELTS 6.5 · Online');
    expect(items[1]).toHaveTextContent('crm.requests.card.updated');
  });

  it('says so when the customer has no request', () => {
    render(<CustomerRequestsCard contactId={CONTACT} industry="spa" />);
    expect(screen.getByText('crm.requests.card.empty')).toBeVisible();
  });
});

describe('ContactHistoryTab', () => {
  it('shows a recorded request with its kind and details', () => {
    render(
      <ContactHistoryTab contactId={CONTACT} lookups={{} as CrmLookups} industry="education" />,
    );
    expect(screen.getByText('crm.history.type.contact.request_recorded')).toBeVisible();
    expect(
      screen.getByText(
        'crm.requests.kind.placement_test · IELTS 6.5 · Cơ sở Cầu Giấy · Thứ Bảy 08/11/2026',
      ),
    ).toBeVisible();
  });
});

describe('balancedColumns', () => {
  it('keeps the rows of the strip even (LM-5)', () => {
    expect(balancedColumns(9, 6)).toBe(5);
    expect(balancedColumns(9, 4)).toBe(3);
    expect(balancedColumns(6, 6)).toBe(6);
    expect(balancedColumns(7, 6)).toBe(4);
    expect(balancedColumns(2, 6)).toBe(2);
  });
});
