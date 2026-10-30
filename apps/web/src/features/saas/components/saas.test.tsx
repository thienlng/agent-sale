import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SaasCustomersPage } from './saas-customers-page';
import { SaasRequestForm } from './saas-request-form';
import { SaasRequestsPage } from './saas-requests-page';
import { SubscriptionCard } from './subscription-card';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  put: vi.fn(),
  can: { 'contacts.edit': true, 'contacts.view_all': true } as Record<string, boolean>,
  subscription: null as unknown,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/permissions', () => ({ useCan: (cap: string) => mocks.can[cap] ?? false }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#link">{children}</a>,
}));
const request = {
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01',
  kind: 'demo',
  status: 'new',
  source: 'bot',
  name: 'Lan',
  phone: '0983456721',
  email: null,
  company: 'Lan Co',
  teamSize: '10-20',
  need: 'CRM cho đội sale',
  preferredTime: 'chiều thứ 5',
  planInterest: '',
  contactId: null,
  conversationId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d02',
  note: '',
  version: 2,
  createdAt: '2026-10-30T08:00:00.000Z',
  updatedAt: '2026-10-30T08:00:00.000Z',
};
vi.mock('../api/saas', () => ({
  useCreateSaasRequest: () => ({ mutate: mocks.create, isPending: false }),
  useUpdateSaasRequest: () => ({ mutate: mocks.update, isPending: false }),
  usePutContactSubscription: () => ({ mutate: mocks.put, isPending: false }),
  useSaasRequests: () => ({ data: { data: [request], nextOffset: null }, isPending: false }),
  useContactSubscription: () => ({
    data: { subscription: mocks.subscription },
    isPending: false,
  }),
  useSaasSummary: () => ({
    data: {
      mrr: 1_500_000,
      stages: { trial: 2, active: 3, past_due: 1, canceled: 0 },
      trialsEndingSoon: 1,
      newRequests: 4,
    },
    isPending: false,
  }),
  useSaasSubscriptions: () => ({
    data: {
      data: [
        {
          id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d03',
          contactId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d04',
          contactName: 'Lan Co',
          planName: 'Pro',
          stage: 'trial',
          billingPeriod: 'monthly',
          mrr: 500_000,
          seats: 5,
          trialEndsOn: '2026-11-05',
          startedOn: null,
          renewsOn: null,
          canceledOn: null,
          externalRef: null,
          note: '',
          version: 1,
          createdAt: '2026-10-30T08:00:00.000Z',
          updatedAt: '2026-10-30T08:00:00.000Z',
        },
      ],
      nextOffset: null,
    },
    isPending: false,
  }),
}));

beforeEach(() => {
  mocks.can = { 'contacts.edit': true, 'contacts.view_all': true };
  mocks.subscription = null;
  mocks.create.mockReset();
  mocks.update.mockReset();
  mocks.put.mockReset();
});

describe('SaaS requests', () => {
  it('lists a bot request and offers only the allowed next statuses', () => {
    render(<SaasRequestsPage />);
    expect(screen.getByText('saas.source.bot · ', { exact: false })).toBeVisible();
    expect(screen.getByText('chiều thứ 5')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'saas.moveTo.contacted' }));
    expect(mocks.update.mock.calls[0]?.[0]).toEqual({
      id: request.id,
      body: { version: 2, status: 'contacted' },
    });
    expect(screen.getByRole('button', { name: 'saas.moveTo.converted' })).toBeVisible();
  });

  it('hides status changes and creation from members who cannot edit customers', () => {
    mocks.can['contacts.edit'] = false;
    render(<SaasRequestsPage />);
    expect(screen.queryByRole('button', { name: 'saas.moveTo.contacted' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'saas.newRequest' })).toBeNull();
  });

  it('needs a phone or an email, then sends one stable request key', () => {
    render(<SaasRequestForm onSaved={vi.fn()} initialName="Lan" />);
    fireEvent.click(screen.getByRole('button', { name: 'saas.saveRequest' }));
    expect(screen.getByRole('alert')).toHaveTextContent('saas.requestInvalid');
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('saas.field.email'), {
      target: { value: 'Lan@Example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'saas.saveRequest' }));
    fireEvent.click(screen.getByRole('button', { name: 'saas.saveRequest' }));
    const [first, second] = mocks.create.mock.calls.map((c) => c[0]);
    expect(first).toMatchObject({
      kind: 'demo',
      name: 'Lan',
      email: 'lan@example.test',
      phone: null,
    });
    expect(second.clientRequestId).toBe(first.clientRequestId);
  });
});

describe('SaaS subscriptions', () => {
  it('shows the revenue summary and the subscribers', () => {
    render(<SaasCustomersPage />);
    expect(screen.getByText('saas.summary.mrr')).toBeVisible();
    expect(screen.getByText('Pro')).toBeVisible();
    expect(screen.getByText('2026-11-05')).toBeVisible();
  });

  it('keeps revenue away from members without view_all', () => {
    mocks.can['contacts.view_all'] = false;
    const { container } = render(<SubscriptionCard contactId={request.id} />);
    expect(container).toBeEmptyDOMElement();
    render(<SaasCustomersPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('saas.revenuePermission');
  });

  it('creates a plan with version null and requires the trial end date', () => {
    render(<SubscriptionCard contactId={request.id} />);
    expect(screen.getByText('saas.sub.none')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'saas.sub.add' }));
    fireEvent.change(screen.getByLabelText('saas.sub.planName'), { target: { value: 'Pro' } });
    fireEvent.change(screen.getByLabelText('saas.sub.mrr'), { target: { value: '500000' } });
    fireEvent.submit(screen.getByRole('button', { name: 'saas.saveSubscription' }));
    expect(mocks.put).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('saas.sub.trialEndsOn'), {
      target: { value: '2026-11-05' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'saas.saveSubscription' }));
    expect(mocks.put.mock.calls[0]?.[0]).toMatchObject({
      version: null,
      planName: 'Pro',
      stage: 'trial',
      mrr: 500000,
      trialEndsOn: '2026-11-05',
    });
  });
});
