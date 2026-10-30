import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StayRequestForm } from './stay-request-form';
import { StayRequestsPage } from './stay-requests-page';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  quote: vi.fn(),
  update: vi.fn(),
  canManage: true,
  propertyId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01',
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/permissions', () => ({ useCan: () => mocks.canManage }));
vi.mock('../api/lodging', () => ({
  useAccommodations: () => ({ data: [{ id: mocks.propertyId, name: 'A17' }], isPending: false }),
  useCreateStay: () => ({ mutate: mocks.create, isPending: false }),
  useStayQuote: () => ({ mutate: mocks.quote, isPending: false }),
  useUpdateStayStatus: () => ({ mutate: mocks.update, isPending: false }),
  useStays: () => ({
    data: {
      data: [
        {
          id: 'stay-1',
          propertyName: 'A17',
          status: 'requested',
          version: 3,
          dates: { checkIn: '2026-11-02', checkOut: '2026-11-04' },
          party: { adults: 24, children: 0, childAges: [] },
          guestName: 'Guest',
          guestPhone: '0000000000',
          note: '',
          agreedTotal: null,
          quote: { baseTotal: null, needsGuestApproval: false },
        },
      ],
    },
    isPending: false,
  }),
}));
beforeEach(() => {
  mocks.canManage = true;
  mocks.create.mockReset();
  mocks.update.mockReset();
  mocks.quote.mockReset();
  mocks.quote.mockImplementation((_body, options) =>
    options.onSuccess({
      nights: 2,
      rateBasis: 'unconfirmed',
      nightlyReferences: [],
      baseTotal: null,
      needsGuestApproval: false,
      internalAvailability: 'unverified',
      isEstimate: true,
    }),
  );
});
function dates() {
  fireEvent.change(screen.getByLabelText('lodging.checkIn'), { target: { value: '2026-11-02' } });
  fireEvent.change(screen.getByLabelText('lodging.checkOut'), { target: { value: '2026-11-04' } });
}
describe('Lodging operator workflow', () => {
  it('invalidates a preview after dates change and saves an unconfirmed request with a stable retry key', () => {
    render(<StayRequestForm onSaved={vi.fn()} initialName="Guest" initialPhone="0000000000" />);
    dates();
    fireEvent.click(screen.getByRole('button', { name: 'lodging.viewQuote' }));
    expect(screen.getByText('lodging.quoteUnknown')).toBeVisible();
    expect(screen.getByText('lodging.calendarUnknown')).toBeVisible();
    fireEvent.change(screen.getByLabelText('lodging.checkOut'), {
      target: { value: '2026-11-05' },
    });
    expect(screen.queryByText('lodging.quoteUnknown')).toBeNull();
    expect(screen.getByText('lodging.staleQuote')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'lodging.createRequest' }));
    fireEvent.click(screen.getByRole('button', { name: 'lodging.createRequest' }));
    expect(mocks.create).toHaveBeenCalledTimes(2);
    const body = mocks.create.mock.calls[0]?.[0];
    expect(body).toMatchObject({
      propertyId: mocks.propertyId,
      dates: { checkOut: '2026-11-05' },
      guestName: 'Guest',
    });
    expect(body).not.toHaveProperty('status');
    expect(body).not.toHaveProperty('agreedTotal');
    expect(mocks.create.mock.calls[1]?.[0]).toEqual(body);
  });
  it('rejects partial child ages before sending and clears ages when children are removed', () => {
    render(<StayRequestForm onSaved={vi.fn()} initialName="Guest" initialPhone="0000000000" />);
    dates();
    fireEvent.change(screen.getByLabelText('lodging.children'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('lodging.childAges'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'lodging.viewQuote' }));
    expect(mocks.quote).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('lodging.children'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'lodging.viewQuote' }));
    expect(mocks.quote.mock.calls[0]?.[0].party).toEqual({ adults: 1, children: 0, childAges: [] });
  });
  it('requires both operator attestations and an explicit price before confirmation', () => {
    render(<StayRequestsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'lodging.confirm' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(screen.getByLabelText('lodging.agreedTotal'), {
      target: { value: '24000000' },
    });
    fireEvent.submit(dialog.querySelector('form')!);
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('lodging.confirmAvailability'));
    fireEvent.click(screen.getByLabelText('lodging.confirmTerms'));
    fireEvent.submit(dialog.querySelector('form')!);
    expect(mocks.update.mock.calls[0]?.[0]).toEqual({
      id: 'stay-1',
      body: {
        status: 'confirmed',
        version: 3,
        agreedTotal: 24000000,
        availabilityVerified: true,
        termsAndGuestsVerified: true,
      },
    });
  });
  it('allows read-only viewing without confirmation or create controls', () => {
    mocks.canManage = false;
    render(<StayRequestsPage />);
    expect(screen.getByText('A17')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'lodging.confirm' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'lodging.newRequest' })).toBeNull();
  });
});
