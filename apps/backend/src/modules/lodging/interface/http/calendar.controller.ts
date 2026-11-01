import {
  AvailabilityRequest,
  CalendarQuery,
  QuoteRequest,
  type AvailabilityDto,
  type CalendarDto,
  type QuoteDto,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';

import {
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { CalendarService } from '../../application/calendar.service.js';

/** Lodging v2 reads (`lodgingV2Routes`): calendar grid, availability search and quotes. */
@WorkspaceScoped()
@Controller('lodging')
export class CalendarController {
  constructor(@Inject(CalendarService) private readonly calendar: CalendarService) {}

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
