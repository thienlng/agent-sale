import {
  AccommodationDetails,
  type CreateStayRequest,
  type StayQuoteRequest,
} from '@agent-sales/contracts';
import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';
import { quoteStay } from '../domain/lodging.js';
import { LodgingService } from '../application/lodging.service.js';
import type { LodgingStore, LodgingTx, StoredStay } from '../application/ports/lodging-store.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';

const details = AccommodationDetails.parse({
  rentalType: 'entire_property',
  bedrooms: 1,
  standardAdults: 2,
  standardChildren: 1,
  childAgeBelow: 6,
  maxGuests: null,
  roomLayout: [{ name: 'Room', beds: 'One bed' }],
  amenities: [],
  rateBasis: 'unconfirmed',
  rates: [
    { days: [1, 2, 3, 4], amount: 100000 },
    { days: [5, 7], amount: 200000 },
    { days: [6], amount: 300000 },
  ],
  gallery: [],
});
const ws = workspaceId(newId()),
  other = workspaceId(newId()),
  propertyId = newId();
const dates = { checkIn: '2027-01-01', checkOut: '2027-01-04' };
const party = { adults: 2, children: 1, childAges: [5] };
const quoteInput: StayQuoteRequest = { propertyId, dates, party };

describe('lodging reference prices and capacity', () => {
  it('preserves Friday/Saturday/Sunday references without summing an unconfirmed rate basis', () => {
    const q = quoteStay(details, quoteInput, false);
    expect(q.nightlyReferences.map((r) => r.amount)).toEqual([200000, 300000, 200000]);
    expect(q.baseTotal).toBeNull();
    expect(q.internalAvailability).toBe('unverified');
    expect(q.needsGuestApproval).toBe(false);
  });
  it('sums only confirmed nightly pricing and counts checkout as exclusive', () => {
    const q = quoteStay({ ...details, rateBasis: 'night' }, quoteInput, true);
    expect(q.nights).toBe(3);
    expect(q.baseTotal).toBe(700000);
    expect(q.internalAvailability).toBe('conflict');
  });
  it('requires owner approval for older children, missing ages, or exceeding the standard party', () => {
    for (const p of [
      { ...party, childAges: [6] },
      { ...party, childAges: [] },
      { ...party, adults: 3 },
      { ...party, children: 2, childAges: [3, 4] },
    ])
      expect(quoteStay(details, { ...quoteInput, party: p }, false).needsGuestApproval).toBe(true);
  });
});

function setup() {
  const rows = new Map<string, StoredStay>();
  const store: LodgingStore = {
    async run(tenant, fn) {
      const tx: LodgingTx = {
        property: async (id) =>
          tenant === ws && id === propertyId
            ? {
                id,
                code: 'TEST',
                name: 'Test property',
                description: '',
                category: null,
                status: 'active',
                visibleToBot: true,
                botInstructions: '',
                imageUrls: [],
                searchText: '',
                createdAt: new Date(),
                updatedAt: new Date(),
                accommodation: details,
              }
            : null,
        lockRequestKey: async () => {},
        find: async (id) =>
          tenant === ws && rows.has(id) ? structuredClone(rows.get(id) ?? null) : null,
        findRequest: async (key) =>
          tenant === ws
            ? structuredClone([...rows.values()].find((r) => r.clientRequestId === key) ?? null)
            : null,
        list: async (filter) =>
          tenant === ws
            ? [...rows.values()].slice(filter.offset ?? 0, (filter.offset ?? 0) + 101)
            : [],
        overlaps: async (id, start, end, excluded) =>
          [...rows.values()].some(
            (r) =>
              tenant === ws &&
              r.id !== excluded &&
              r.propertyId === id &&
              r.status === 'confirmed' &&
              r.dates.checkIn < end &&
              r.dates.checkOut > start,
          ),
        insert: async (r) => {
          rows.set(r.id, structuredClone(r));
        },
        update: async (r) => {
          rows.set(r.id, structuredClone(r));
        },
        audit: async () => {},
      };
      return fn(tx);
    },
  };
  const workspaces = { getById: async () => ({ industry: 'hotel' }) } as unknown as WorkspaceFacade;
  const service = new LodgingService(store, workspaces);
  const body: CreateStayRequest = {
    ...quoteInput,
    clientRequestId: newId(),
    guestName: 'Test guest',
    guestPhone: '0000000000',
    note: '',
  };
  return { service, body, rows };
}

describe('stay request lifecycle', () => {
  it('keeps older requests accessible beyond the first hundred inquiries', async () => {
    const { service, body } = setup();
    for (let i = 0; i < 101; i++)
      await service.create(ws, { ...body, clientRequestId: newId() }, newId());
    const first = await service.list(ws, {});
    expect(first.data).toHaveLength(100);
    expect(first.nextOffset).toBe(100);
    const next = await service.list(ws, { offset: first.nextOffset ?? 0 });
    expect(next.data).toHaveLength(1);
    expect(next.nextOffset).toBeNull();
    expect(first.data.some((r) => r.id === next.data[0]?.id)).toBe(false);
  });

  it('persists an unconfirmed request, replays the same key, and rejects changed payloads', async () => {
    const { service, body, rows } = setup();
    const first = await service.create(ws, body, newId());
    expect(first.status).toBe('requested');
    expect(first.agreedTotal).toBeNull();
    expect(await service.create(ws, body, newId())).toEqual(first);
    expect(rows.size).toBe(1);
    await expect(
      service.create(ws, { ...body, guestName: 'Another guest' }, newId()),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('hides another tenant request and rejects another tenant property', async () => {
    const { service, body } = setup();
    const first = await service.create(ws, body, newId());
    await expect(service.get(other, first.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      service.create(other, { ...body, clientRequestId: newId() }, newId()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('blocks overlapping confirmations, allows checkout-adjacent stays and releases dates on cancellation', async () => {
    const { service, body } = setup();
    const a = await service.create(ws, body, newId());
    const b = await service.create(ws, { ...body, clientRequestId: newId() }, newId());
    const confirmed = await service.updateStatus(
      ws,
      a.id,
      {
        status: 'confirmed',
        version: 1,
        agreedTotal: 700000,
        availabilityVerified: true,
        termsAndGuestsVerified: true,
      },
      newId(),
    );
    await expect(
      service.updateStatus(
        ws,
        b.id,
        {
          status: 'confirmed',
          version: 1,
          agreedTotal: 700000,
          availabilityVerified: true,
          termsAndGuestsVerified: true,
        },
        newId(),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const adjacent = await service.create(
      ws,
      {
        ...body,
        clientRequestId: newId(),
        dates: { checkIn: body.dates.checkOut, checkOut: '2027-01-05' },
      },
      newId(),
    );
    await expect(
      service.updateStatus(
        ws,
        adjacent.id,
        {
          status: 'confirmed',
          version: 1,
          agreedTotal: 100000,
          availabilityVerified: true,
          termsAndGuestsVerified: true,
        },
        newId(),
      ),
    ).resolves.toMatchObject({ status: 'confirmed' });
    await service.updateStatus(ws, confirmed.id, { status: 'cancelled', version: 2 }, newId());
    await expect(
      service.updateStatus(
        ws,
        b.id,
        {
          status: 'confirmed',
          version: 1,
          agreedTotal: 700000,
          availabilityVerified: true,
          termsAndGuestsVerified: true,
        },
        newId(),
      ),
    ).resolves.toMatchObject({ status: 'confirmed' });
  });
  it('rejects stale updates and an attempted revival of a cancelled stay', async () => {
    const { service, body } = setup();
    const r = await service.create(ws, body, newId());
    await service.updateStatus(ws, r.id, { status: 'reviewing', version: 1 }, newId());
    await expect(
      service.updateStatus(ws, r.id, { status: 'cancelled', version: 1 }, newId()),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await service.updateStatus(ws, r.id, { status: 'cancelled', version: 2 }, newId());
    await expect(
      service.updateStatus(ws, r.id, { status: 'reviewing', version: 3 }, newId()),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
