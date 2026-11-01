import {
  BookingListQuery,
  BookingStatusRequest,
  CreateBookingRequest,
  UpdateBookingRequest,
  type BookingDetail,
  type BookingList,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import {
  CurrentUser,
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
  type AuthState,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import type { Actor } from '../../application/booking-support.js';
import { BookingService } from '../../application/booking.service.js';

const Id = new ZodValidationPipe(z.uuid());

/** The acting user with their display name (looked up only for writes). */
const actorOf = async (u: AuthState): Promise<Actor> => ({
  id: u.userId,
  name: (await u.displayName?.()) ?? null,
});

/** Lodging v2 bookings (`lodgingV2Routes`): lists, detail, create, edit and status moves. */
@WorkspaceScoped()
@Controller('lodging')
export class BookingsController {
  constructor(@Inject(BookingService) private readonly bookings: BookingService) {}

  @Get('bookings')
  @RequireCapability('orders.view')
  list(
    @CurrentWorkspace() ws: WorkspaceId,
    @Query(new ZodValidationPipe(BookingListQuery)) q: BookingListQuery,
  ): Promise<BookingList> {
    return this.bookings.list(ws, q);
  }

  @Post('bookings')
  @HttpCode(201)
  @RequireCapability('orders.manage')
  async create(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(CreateBookingRequest)) body: CreateBookingRequest,
  ): Promise<BookingDetail> {
    return this.bookings.create(ws, body, await actorOf(user));
  }

  @Get('bookings/:id')
  @RequireCapability('orders.view')
  get(@CurrentWorkspace() ws: WorkspaceId, @Param('id', Id) id: string): Promise<BookingDetail> {
    return this.bookings.get(ws, id);
  }

  @Patch('bookings/:id')
  @RequireCapability('orders.manage')
  async update(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('id', Id) id: string,
    @Body(new ZodValidationPipe(UpdateBookingRequest)) body: UpdateBookingRequest,
  ): Promise<BookingDetail> {
    return this.bookings.update(ws, id, body, await actorOf(user));
  }

  @Post('bookings/:id/status')
  @HttpCode(200)
  @RequireCapability('orders.manage')
  async changeStatus(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('id', Id) id: string,
    @Body(new ZodValidationPipe(BookingStatusRequest)) body: BookingStatusRequest,
  ): Promise<BookingDetail> {
    return this.bookings.changeStatus(ws, id, body, await actorOf(user));
  }
}
