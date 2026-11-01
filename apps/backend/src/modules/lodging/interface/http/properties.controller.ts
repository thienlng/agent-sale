import {
  BotPropertiesDto,
  CreateOverrideRequest,
  DeleteOverrideQuery,
  LodgingSettings,
  PropertyInput,
  PutRatesRequest,
  ReplaceUnitsRequest,
  UpdateOverrideRequest,
  UpdatePropertyRequest,
  type PropertyDto,
  type PropertyList,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';

import {
  CurrentUser,
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
  type AuthState,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { LodgingSettingsService } from '../../application/lodging-settings.service.js';
import { PropertyService } from '../../application/property.service.js';
import { RatesService } from '../../application/rates.service.js';

const Id = new ZodValidationPipe(z.uuid());

/** Lodging v2 setup routes (`lodgingV2Routes`): properties, rooms, rates, settings, bots. */
@WorkspaceScoped()
@Controller('lodging')
export class PropertiesController {
  constructor(
    @Inject(PropertyService) private readonly properties: PropertyService,
    @Inject(RatesService) private readonly rates: RatesService,
    @Inject(LodgingSettingsService) private readonly settings: LodgingSettingsService,
  ) {}

  @Get('properties')
  @RequireCapability('orders.view')
  list(@CurrentWorkspace() ws: WorkspaceId): Promise<PropertyList> {
    return this.properties.list(ws);
  }

  @Post('properties')
  @HttpCode(201)
  @RequireCapability('catalog.manage')
  create(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() actor: AuthState,
    @Body(new ZodValidationPipe(PropertyInput)) body: z.output<typeof PropertyInput>,
  ): Promise<PropertyDto> {
    return this.properties.create(ws, body, actor.userId);
  }

  @Get('properties/:id')
  @RequireCapability('orders.view')
  get(@CurrentWorkspace() ws: WorkspaceId, @Param('id', Id) id: string): Promise<PropertyDto> {
    return this.properties.get(ws, id);
  }

  @Patch('properties/:id')
  @RequireCapability('catalog.manage')
  update(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() actor: AuthState,
    @Param('id', Id) id: string,
    @Body(new ZodValidationPipe(UpdatePropertyRequest)) body: UpdatePropertyRequest,
  ): Promise<PropertyDto> {
    return this.properties.update(ws, id, body, actor.userId);
  }

  @Put('properties/:id/units')
  @RequireCapability('catalog.manage')
  replaceUnits(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() actor: AuthState,
    @Param('id', Id) id: string,
    @Body(new ZodValidationPipe(ReplaceUnitsRequest)) body: ReplaceUnitsRequest,
  ): Promise<PropertyDto> {
    return this.properties.replaceUnits(ws, id, body, actor.userId);
  }

  @Put('properties/:id/rates')
  @RequireCapability('catalog.manage')
  putRates(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() actor: AuthState,
    @Param('id', Id) id: string,
    @Body(new ZodValidationPipe(PutRatesRequest)) body: PutRatesRequest,
  ): Promise<PropertyDto> {
    return this.rates.putRates(ws, id, body, actor.userId);
  }

  @Post('properties/:id/overrides')
  @HttpCode(201)
  @RequireCapability('catalog.manage')
  createOverride(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() actor: AuthState,
    @Param('id', Id) id: string,
    @Body(new ZodValidationPipe(CreateOverrideRequest)) body: CreateOverrideRequest,
  ): Promise<PropertyDto> {
    return this.rates.createOverride(ws, id, body, actor.userId);
  }

  @Patch('properties/:id/overrides/:rateId')
  @RequireCapability('catalog.manage')
  updateOverride(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() actor: AuthState,
    @Param('id', Id) id: string,
    @Param('rateId', Id) rateId: string,
    @Body(new ZodValidationPipe(UpdateOverrideRequest)) body: UpdateOverrideRequest,
  ): Promise<PropertyDto> {
    return this.rates.updateOverride(ws, id, rateId, body, actor.userId);
  }

  @Delete('properties/:id/overrides/:rateId')
  @RequireCapability('catalog.manage')
  deleteOverride(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() actor: AuthState,
    @Param('id', Id) id: string,
    @Param('rateId', Id) rateId: string,
    @Query(new ZodValidationPipe(DeleteOverrideQuery)) q: z.output<typeof DeleteOverrideQuery>,
  ): Promise<PropertyDto> {
    return this.rates.deleteOverride(ws, id, rateId, q.version, actor.userId);
  }

  @Get('settings')
  @RequireCapability('orders.view')
  getSettings(@CurrentWorkspace() ws: WorkspaceId): Promise<LodgingSettings> {
    return this.settings.get(ws);
  }

  @Patch('settings')
  @RequireCapability('catalog.manage')
  updateSettings(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() actor: AuthState,
    @Body(new ZodValidationPipe(LodgingSettings)) body: LodgingSettings,
  ): Promise<LodgingSettings> {
    return this.settings.update(ws, body, actor.userId);
  }

  @Get('bots/:botId/properties')
  @RequireCapability('orders.view')
  botProperties(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('botId', Id) botId: string,
  ): Promise<BotPropertiesDto> {
    return this.settings.botProperties(ws, botId);
  }

  /** What a bot sells is bot configuration, so it needs `bots.manage`. */
  @Put('bots/:botId/properties')
  @RequireCapability('bots.manage')
  setBotProperties(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() actor: AuthState,
    @Param('botId', Id) botId: string,
    @Body(new ZodValidationPipe(BotPropertiesDto)) body: BotPropertiesDto,
  ): Promise<BotPropertiesDto> {
    return this.settings.setBotProperties(ws, botId, body, actor.userId);
  }
}
