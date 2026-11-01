import {
  AvailabilityRequest,
  CalendarQuery,
  PutNightNoteRequest,
  QuoteRequest,
  type AvailabilityDto,
  type CalendarDto,
  type NightNoteResult,
  type QuoteDto,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';

import {
  CurrentUser,
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
  type AuthState,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { CalendarService } from '../../application/calendar.service.js';
import { NightNotesService } from '../../application/night-notes.service.js';

const Id = new ZodValidationPipe(z.uuid());

/**
 * Lodging v2 calendar routes (`lodgingV2Routes`): calendar grid, availability search, quotes
 * and the staff-only night notes shown on the grid.
 */
@WorkspaceScoped()
@Controller('lodging')
export class CalendarController {
  constructor(
    @Inject(CalendarService) private readonly calendar: CalendarService,
    @Inject(NightNotesService) private readonly notes: NightNotesService,
  ) {}

  @Get('calendar')
  @RequireCapability('orders.view')
  grid(
    @CurrentWorkspace() ws: WorkspaceId,
    @Query(new ZodValidationPipe(CalendarQuery)) q: CalendarQuery,
  ): Promise<CalendarDto> {
    return this.calendar.calendar(ws, q);
  }

  /** A search, not a write: POST only because of the body. */
  @Post('availability')
  @HttpCode(200)
  @RequireCapability('orders.view')
  availability(
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ZodValidationPipe(AvailabilityRequest)) body: AvailabilityRequest,
  ): Promise<AvailabilityDto> {
    return this.calendar.availability(ws, body);
  }

  /** Night notes are calendar work, so they follow the booking capability. */
  @Put('properties/:id/notes')
  @RequireCapability('orders.manage')
  putNote(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() actor: AuthState,
    @Param('id', Id) id: string,
    @Body(new ZodValidationPipe(PutNightNoteRequest)) body: PutNightNoteRequest,
  ): Promise<NightNoteResult> {
    return this.notes.put(ws, id, body, actor.userId);
  }

  @Post('quote')
  @HttpCode(200)
  @RequireCapability('orders.view')
  quote(
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ZodValidationPipe(QuoteRequest)) body: QuoteRequest,
  ): Promise<QuoteDto> {
    return this.calendar.quote(ws, body);
  }
}
