import { createHash } from 'node:crypto';
import {
  CreateStayRequest,
  type StayQuote,
  type StayQuoteRequest,
  type StayRequestDto,
  UpdateStayStatusRequest,
} from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import { LodgingError, assertStayTransition, quoteStay } from '../domain/lodging.js';
import {
  LODGING_STORE,
  type LodgingStore,
  type LodgingTx,
  type StoredStay,
} from './ports/lodging-store.js';
import type { ProductRecord } from './ports/commerce-store.js';

const dto = ({ fingerprint: _fingerprint, ...row }: StoredStay): StayRequestDto => row;

@Injectable()
export class LodgingService {
  constructor(
    @Inject(LODGING_STORE) private readonly store: LodgingStore,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
  ) {}

  async assertHotel(ws: WorkspaceId): Promise<void> {
    if ((await this.workspaces.getById(ws)).industry !== 'hotel')
      throw new LodgingError('NOT_FOUND', 'Lodging workspace not found');
  }
  private async property(
    tx: LodgingTx,
    id: string,
    lock = false,
  ): Promise<ProductRecord & { accommodation: NonNullable<ProductRecord['accommodation']> }> {
    const p = await tx.property(id, lock);
    if (!p?.accommodation || p.status !== 'active')
      throw new LodgingError('NOT_FOUND', 'Accommodation not found');
    return { ...p, accommodation: p.accommodation };
  }
  async list(
    ws: WorkspaceId,
    filter: {
      propertyId?: string | undefined;
      status?: string | undefined;
      offset?: number | undefined;
    },
  ): Promise<{ data: StayRequestDto[]; nextOffset: number | null }> {
    await this.assertHotel(ws);
    return this.store.run(ws, async (tx) => {
      if (filter.propertyId) await this.property(tx, filter.propertyId);
      const rows = await tx.list(filter);
      return {
        data: rows.slice(0, 100).map(dto),
        nextOffset: rows.length > 100 ? (filter.offset ?? 0) + 100 : null,
      };
    });
  }
  async get(ws: WorkspaceId, id: string): Promise<StayRequestDto> {
    await this.assertHotel(ws);
    return this.store.run(ws, async (tx) => {
      const r = await tx.find(id);
      if (!r) throw new LodgingError('NOT_FOUND', 'Stay request not found');
      return dto(r);
    });
  }
  async quote(ws: WorkspaceId, input: StayQuoteRequest): Promise<StayQuote> {
    await this.assertHotel(ws);
    return this.store.run(ws, async (tx) => {
      const p = await this.property(tx, input.propertyId);
      return quoteStay(
        p.accommodation,
        input,
        await tx.overlaps(p.id, input.dates.checkIn, input.dates.checkOut),
      );
    });
  }
  async create(ws: WorkspaceId, raw: CreateStayRequest, actorId: string): Promise<StayRequestDto> {
    await this.assertHotel(ws);
    const input = CreateStayRequest.parse(raw);
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.store.run(ws, async (tx) => {
      await tx.lockRequestKey(input.clientRequestId);
      const existing = await tx.findRequest(input.clientRequestId);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new LodgingError(
            'CONFLICT',
            'This request key was used for different lodging details',
          );
        return dto(existing);
      }
      const p = await this.property(tx, input.propertyId);
      const quote = quoteStay(
        p.accommodation,
        input,
        await tx.overlaps(p.id, input.dates.checkIn, input.dates.checkOut),
      );
      const now = new Date().toISOString();
      const row: StoredStay = {
        id: newId(),
        propertyId: p.id,
        propertyName: p.name,
        clientRequestId: input.clientRequestId,
        fingerprint,
        guestName: input.guestName,
        guestPhone: input.guestPhone,
        dates: input.dates,
        party: input.party,
        note: input.note,
        status: 'requested',
        quote,
        agreedTotal: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await tx.insert(row);
      await tx.audit(actorId, row.id, row.status);
      return dto(row);
    });
  }
  async updateStatus(
    ws: WorkspaceId,
    id: string,
    raw: UpdateStayStatusRequest,
    actorId: string,
  ): Promise<StayRequestDto> {
    await this.assertHotel(ws);
    const input = UpdateStayStatusRequest.parse(raw);
    return this.store.run(ws, async (tx) => {
      const row = await tx.find(id, true);
      if (!row) throw new LodgingError('NOT_FOUND', 'Stay request not found');
      if (row.version !== input.version)
        throw new LodgingError('CONFLICT', 'The stay request changed; reload before updating');
      assertStayTransition(row.status, input.status);
      if (input.status === 'confirmed') {
        const property = await this.property(tx, row.propertyId, true);
        if (
          property.accommodation.maxGuests !== null &&
          row.party.adults + row.party.children > property.accommodation.maxGuests
        )
          throw new LodgingError(
            'VALIDATION_FAILED',
            'The party exceeds the property maximum capacity',
          );
        if (await tx.overlaps(row.propertyId, row.dates.checkIn, row.dates.checkOut, row.id))
          throw new LodgingError(
            'CONFLICT',
            'The property already has a confirmed stay for these dates',
          );
        row.agreedTotal = input.agreedTotal ?? null;
      }
      row.status = input.status;
      row.version += 1;
      row.updatedAt = new Date().toISOString();
      await tx.update(row);
      await tx.audit(actorId, row.id, row.status);
      return dto(row);
    });
  }
}
