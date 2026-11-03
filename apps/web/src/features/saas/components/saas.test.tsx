import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SaasPlansManager } from './saas-plans-manager';
import { SaasSummaryStrip } from './saas-summary-strip';
import { SubscriptionCard } from './subscription-card';
import { useSubscriptionColumns } from './subscription-columns';

const mocks = vi.hoisted(() => ({
  put: vi.fn(),
  createPlan: vi.fn(),
  plans: [] as unknown[],
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
  planId: null,
  churnReason: null,
  churnNote: '',
  linked: null,
  usage: null,
  upsell: false,
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
      stages: { trial: 2, free: 4, active: 3, past_due: 1, canceled: 0 },
      trialsEndingSoon: 1,
    },
    isPending: false,
  }),
  useTrialsEndingSoon: () => ({ data: { data: [trial], nextOffset: null }, isPending: false }),
  useSubscriptionsOf: () => ({ data: new Map([[CONTACT, trial]]) }),
  useSubscriptionHistory: () => ({ data: { data: [] }, isPending: false }),
  useSaasPlans: () => ({ data: { data: mocks.plans } }),
  useSaasPlanMutations: () => ({
    create: { mutate: mocks.createPlan, isPending: false },
    update: { mutate: vi.fn(), isPending: false },
  }),
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
  mocks.plans = [];
  mocks.put.mockReset();
  mocks.createPlan.mockReset();
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

  it('shows a Rapiz-synced row read-only but keeps seats and note editable', () => {
    mocks.subscription = {
      ...trial,
      stage: 'active',
      trialEndsOn: null,
      externalRef: 'acct-1',
      linked: { source: 'rapiz' },
      usage: { used: 85, limit: 100, at: '2026-11-01T00:00:00.000Z' },
      upsell: true,
    };
    render(<SubscriptionCard contactId={CONTACT} />);
    expect(screen.getByText('saas.sub.linked')).toBeVisible();
    expect(screen.getByText('saas.sub.upsell')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'saas.sub.edit' }));
    expect(screen.getByText('saas.sub.linkedHint')).toBeVisible();
    expect(screen.getByLabelText('saas.sub.planName')).toBeDisabled();
    expect(screen.getByLabelText('saas.sub.mrr')).toBeDisabled();
    expect(screen.getByLabelText('saas.sub.seats')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('saas.sub.seats'), { target: { value: '9' } });
    fireEvent.submit(screen.getByRole('button', { name: 'saas.saveSubscription' }));
    expect(mocks.put.mock.calls[0]?.[0]).toMatchObject({
      version: 1,
      stage: 'active',
      mrr: 500000,
      seats: 9,
      externalRef: 'acct-1',
    });
  });

  it('requires a churn reason when staff cancel a subscription', () => {
    mocks.subscription = { ...trial, stage: 'canceled', canceledOn: '2026-11-02' };
    render(<SubscriptionCard contactId={CONTACT} />);
    fireEvent.click(screen.getByRole('button', { name: 'saas.sub.edit' }));
    expect(screen.getByLabelText('saas.sub.churnNote')).toBeVisible();
    fireEvent.submit(screen.getByRole('button', { name: 'saas.saveSubscription' }));
    expect(mocks.put).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('saas.subscriptionInvalid');
  });

  it('takes the name and MRR from a catalog plan', () => {
    const plan = {
      id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d05',
      name: 'Growth',
      prices: { monthly: 1_200_000 },
      position: 0,
      archived: false,
      version: 1,
      createdAt: '2026-10-30T08:00:00.000Z',
      updatedAt: '2026-10-30T08:00:00.000Z',
    };
    mocks.plans = [plan];
    mocks.subscription = { ...trial, planId: plan.id, planName: 'Growth' };
    render(<SubscriptionCard contactId={CONTACT} />);
    fireEvent.click(screen.getByRole('button', { name: 'saas.sub.edit' }));
    expect(screen.queryByLabelText('saas.sub.planName')).toBeNull();
    fireEvent.submit(screen.getByRole('button', { name: 'saas.saveSubscription' }));
    expect(mocks.put.mock.calls[0]?.[0]).toMatchObject({
      planId: plan.id,
      planName: 'Growth',
      mrr: 1_200_000,
    });
  });

  it('adds a plan with its period prices', () => {
    render(<SaasPlansManager />);
    expect(screen.getByText('saas.plans.none')).toBeVisible();
    fireEvent.change(screen.getByLabelText('saas.plans.newName'), { target: { value: 'Pro' } });
    const prices = screen.getAllByLabelText('saas.plans.price');
    fireEvent.change(prices[3] as HTMLElement, { target: { value: '12000000' } });
    fireEvent.submit(screen.getByRole('button', { name: 'saas.plans.add' }));
    expect(mocks.createPlan.mock.calls[0]?.[0]).toEqual({
      name: 'Pro',
      prices: { yearly: 12_000_000 },
      position: 0,
    });
  });
});
