import type { BookingDetail, PackageDto, QuoteDto } from '@agent-sales/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { bookingFixture, LODGING_IDS, propertyFixture } from '@/testing/lodging-factories';
import { renderWithRouter } from '@/testing/render';

import { BookingSheet, type BookingSheetProps } from './booking-sheet';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
vi.mock('@/lib/permissions', () => ({ useCan: () => true }));
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});
afterEach(() => vi.unstubAllGlobals());

const PROP = LODGING_IDS.a17;
const BK = LODGING_IDS.bk1;
const pkg = (id: string, name: string, bedrooms: number, sortOrder: number): PackageDto => ({
  id,
  unitId: null,
  name,
  bedrooms,
  standardAdults: bedrooms * 2,
  standardChildren: 0,
  maxGuests: bedrooms * 2 + 2,
  sortOrder,
});
const P6 = pkg('0193a000-0000-7000-8000-000000000706', '6PN', 6, 0);
const P5 = pkg('0193a000-0000-7000-8000-000000000705', '5PN', 5, 1);
const P4 = pkg('0193a000-0000-7000-8000-000000000704', '4PN', 4, 2);
const aura = propertyFixture({
  id: PROP,
  code: 'AURA',
  name: 'Aura Villa',
  packages: [P6, P5, P4],
});
const total: Record<string, number> = { [P6.id]: 30_000_000, [P5.id]: 27_000_000 };

/** The quote of the chosen package; without a choice the server auto-picks 5PN. */
const quoteOf = (packageIds: string[] = []): QuoteDto => {
  const chosen = [P6, P5, P4].find((k) => k.id === packageIds[0]) ?? P5;
  return {
    nights: [{ date: '2099-11-06', weekday: 5, label: '', sell: total[chosen.id] ?? 0, cost: 0 }],
    surcharges: [],
    totalSell: total[chosen.id] ?? 0,
    totalCost: 0,
    warnings: [],
    takenBy: [],
    packages: [{ target: null, packageId: chosen.id, name: chosen.name }],
  };
};

function stubApi(extra: Record<string, { status: number; body: unknown }> = {}) {
  const calls: Array<{ key: string; body: Record<string, unknown> | undefined }> = [];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${input.replace('/api/v1', '').split('?')[0]}`;
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ key, body });
    const reply =
      key === 'POST /lodging/quote'
        ? { status: 200, body: quoteOf(body?.['packageIds'] as string[] | undefined) }
        : key === 'GET /lodging/properties'
          ? { status: 200, body: { data: [] } }
          : key === `GET /lodging/properties/${PROP}`
            ? { status: 200, body: aura }
            : extra[key];
    if (!reply) throw new Error(`unexpected request ${key}`);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return calls;
}

function renderSheet(props: Partial<BookingSheetProps> & Pick<BookingSheetProps, 'mode'>) {
  const all = { open: true, onOpenChange: () => {}, ...props } as BookingSheetProps;
  renderWithRouter(() => (
    <TooltipProvider>
      <BookingSheet {...all} />
    </TooltipProvider>
  ));
}

const stored = (): BookingDetail => ({
  ...bookingFixture({
    id: BK,
    propertyId: PROP,
    checkIn: '2099-11-06',
    checkOut: '2099-11-07',
    party: { adults: 8, childAges: [] },
    packageIds: [P5.id],
    packageNames: ['5PN'],
    quote: quoteOf([P5.id]),
    totalSell: 27_000_000,
  }),
  history: [],
});

describe('booking package select', () => {
  it('defaults to the quote’s package, re-quotes on a change and creates with the choice', async () => {
    const calls = stubApi({
      'POST /lodging/bookings': { status: 201, body: stored() },
    });
    const user = userEvent.setup();
    renderSheet({
      mode: 'create',
      initial: {
        propertyId: PROP,
        checkIn: '2099-11-06',
        checkOut: '2099-11-07',
        guestName: 'Anh Nam',
        party: { adults: 8, childAges: [] },
      },
    });
    const sheet = await screen.findByRole('dialog');
    const select = await within(sheet).findByRole('combobox', { name: 'Gói' });
    await waitFor(() => expect(select).toHaveTextContent('5PN'));
    expect(within(sheet).getByText('Gói: 5PN')).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /lodging/quote')?.body).not.toHaveProperty(
      'packageIds',
    );

    await user.click(select);
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['6PN', '5PN', '4PN']);
    await user.click(screen.getByRole('option', { name: '6PN' }));
    await waitFor(() => expect(within(sheet).getByText('Gói: 6PN')).toBeInTheDocument());
    expect(within(sheet).getByTestId('quote-total')).toHaveTextContent('30.000.000');
    expect(calls.filter((c) => c.key === 'POST /lodging/quote').at(-1)?.body).toMatchObject({
      packageIds: [P6.id],
    });

    await user.click(within(sheet).getByRole('button', { name: 'Giữ chỗ' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /lodging/bookings')?.body).toMatchObject({
        kind: 'stay',
        packageIds: [P6.id],
      }),
    );
  });

  it('omits packageIds on an edit that keeps the package and sends it when it changes', async () => {
    const calls = stubApi({
      [`GET /lodging/bookings/${BK}`]: { status: 200, body: stored() },
      [`PATCH /lodging/bookings/${BK}`]: { status: 200, body: stored() },
    });
    const user = userEvent.setup();
    renderSheet({ mode: 'view', bookingId: BK });
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByText('Nguyên căn · 5PN')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Sửa' }));
    const name = within(sheet).getByLabelText('Tên khách');
    await user.type(name, ' Nguyễn');
    await user.click(within(sheet).getByRole('button', { name: 'Lưu' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key.startsWith('PATCH'))?.body).toEqual({
        version: stored().version,
        guestName: `${stored().guestName} Nguyễn`,
      }),
    );

    await user.click(await within(sheet).findByRole('button', { name: 'Sửa' }));
    const select = within(sheet).getByRole('combobox', { name: 'Gói' });
    await waitFor(() => expect(select).toHaveTextContent('5PN'));
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: '6PN' }));
    await waitFor(() => expect(within(sheet).getByText('Gói: 6PN')).toBeInTheDocument());
    await user.click(within(sheet).getByRole('button', { name: 'Lưu' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.key.startsWith('PATCH')).at(-1)?.body).toEqual({
        version: stored().version,
        packageIds: [P6.id],
        party: { adults: 8, childAges: [] },
      }),
    );
  });
});
