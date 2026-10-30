import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SaasSummaryStrip } from './saas-summary-strip';
import { SubscriptionCard } from './subscription-card';
import { useSubscriptionColumns } from './subscription-columns';

const mocks = vi.hoisted(() => ({
  put: vi.fn(),
  can: { 'contacts.edit': true, 'contacts.view_all': true } as Record<string, boolean>,
  subscription: null as unknown,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/permissions', () => ({ useCan: (cap: string) => mocks.can[cap] ?? false }));
const CONTACT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d04';
const trial = {
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d03',
  contactId: CONTACT,
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
};
vi.mock('../api/saas', () => ({
  usePutContactSubscription: () => ({ mutate: mocks.put, isPending: false }),
  useContactSubscription: () => ({
    data: { subscription: mocks.subscription },
    isPending: false,
  }),
  useSaasSummary: () => ({
    data: {
      mrr: 1_500_000,
      stages: { trial: 2, active: 3, past_due: 1, canceled: 0 },
      trialsEndingSoon: 1,
    },
    isPending: false,
  }),
  useTrialsEndingSoon: () => ({ data: { data: [trial], nextOffset: null }, isPending: false }),
  useSubscriptionsOf: () => ({ data: new Map([[CONTACT, trial]]) }),
}));

function Columns({ enabled }: { enabled: boolean }) {
  const columns = useSubscriptionColumns([CONTACT], enabled);
  return (
    <ul>
      {columns.map((c) => (
        <li key={c.id}>
          {c.header}: {c.cell(CONTACT)}
        </li>
      ))}
    </ul>
  );
}

beforeEach(() => {
  mocks.can = { 'contacts.edit': true, 'contacts.view_all': true };
  mocks.subscription = null;
  mocks.put.mockReset();
});

describe('SaaS subscriptions', () => {
  it('filters the customer list by stage and lists trials ending soon', () => {
    const onStage = vi.fn(),
      onOpenContact = vi.fn();
    render(<SaasSummaryStrip onStage={onStage} onOpenContact={onOpenContact} />);
    expect(screen.getByText('saas.summary.mrr')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /saas.summary.past_due/ }));
    expect(onStage).toHaveBeenCalledWith('past_due');
    fireEvent.click(screen.getByRole('button', { name: /saas.summary.trialsEndingSoon/ }));
    fireEvent.click(screen.getByRole('button', { name: /Lan Co/ }));
    expect(onOpenContact).toHaveBeenCalledWith(CONTACT);
  });

  it('adds plan, MRR and trial end columns to the customer rows', () => {
    render(<Columns enabled />);
    expect(screen.getByText(/saas.col.plan/)).toHaveTextContent('saas.col.plan: Pro');
    expect(screen.getByText(/saas.col.next/)).toHaveTextContent('05/11/2026');
  });

  it('keeps revenue away from members without view_all', () => {
    mocks.can['contacts.view_all'] = false;
    const { container } = render(<SubscriptionCard contactId={CONTACT} />);
    expect(container).toBeEmptyDOMElement();
    const strip = render(<SaasSummaryStrip onStage={vi.fn()} onOpenContact={vi.fn()} />);
    expect(strip.container).toBeEmptyDOMElement();
    const columns = render(<Columns enabled={false} />);
    expect(columns.container.querySelectorAll('li')).toHaveLength(0);
  });

  it('creates a plan with version null and requires the trial end date', () => {
    render(<SubscriptionCard contactId={CONTACT} />);
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
