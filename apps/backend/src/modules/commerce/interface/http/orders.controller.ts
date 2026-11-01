import {
  ApproveOrderRequest,
  ChangeOrderStatusRequest,
  CreateOrderRequest,
  type OrderDto,
  OrderListQuery,
  type OrderListResponse,
  OrderOverviewQuery,
  type OrderOverviewResponse,
  type OrderReviewCountResponse,
  OrderSettingsDto,
  UpdateOrderRequest,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { z } from 'zod';

import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { OrderReviewService } from '../../application/order-review.service.js';
import { OrderService } from '../../application/order.service.js';

/** Thin controller: orders, overview and order settings. */
@WorkspaceScoped()
@Controller()
export class OrdersController {
  constructor(
    @Inject(OrderService) private readonly orders: OrderService,
    @Inject(OrderReviewService) private readonly reviews: OrderReviewService,
  ) {}

  @RequireCapability('orders.view')
  @Get('orders')
  list(
    @CurrentWorkspace() ws: WorkspaceId,
    @Query(new ZodValidationPipe(OrderListQuery)) query: z.infer<typeof OrderListQuery>,
  ): Promise<OrderListResponse> {
    return this.orders.list(ws, query);
  }

  @RequireCapability('orders.manage')
  @Post('orders')
  @HttpCode(201)
  create(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(CreateOrderRequest)) body: CreateOrderRequest,
  ): Promise<OrderDto> {
    return this.orders.create(ws, body, user.userId);
  }

  // Declared before orders/:orderId so "overview" is not taken for an id.
  @RequireCapability('orders.view')
  @Get('orders/overview')
  overview(
    @CurrentWorkspace() ws: WorkspaceId,
    @Query(new ZodValidationPipe(OrderOverviewQuery)) query: z.infer<typeof OrderOverviewQuery>,
  ): Promise<OrderOverviewResponse> {
    return this.orders.overview(ws, query);
  }

  // Declared before orders/:orderId so "review-count" is not taken for an id.
  @RequireCapability('orders.view')
  @Get('orders/review-count')
  reviewCount(@CurrentWorkspace() ws: WorkspaceId): Promise<OrderReviewCountResponse> {
    return this.reviews.reviewCount(ws);
  }

  @RequireCapability('orders.view')
  @Get('orders/:orderId')
  get(@CurrentWorkspace() ws: WorkspaceId, @Param('orderId') id: string): Promise<OrderDto> {
    return this.orders.get(ws, id);
  }

  @RequireCapability('orders.manage')
  @Patch('orders/:orderId')
  update(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('orderId') id: string,
    @Body(new ZodValidationPipe(UpdateOrderRequest)) body: UpdateOrderRequest,
  ): Promise<OrderDto> {
    return this.orders.update(ws, id, body, user.userId);
  }

  @RequireCapability('orders.manage')
  @Post('orders/:orderId/status')
  @HttpCode(200)
  changeStatus(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('orderId') id: string,
    @Body(new ZodValidationPipe(ChangeOrderStatusRequest)) body: ChangeOrderStatusRequest,
  ): Promise<OrderDto> {
    return this.orders.changeStatus(ws, id, body, user.userId);
  }

  /** Staff review of a bot order; `approve:false` undoes a fresh approval (ADR-016). */
  @RequireCapability('orders.manage')
  @Post('orders/:orderId/approve')
  @HttpCode(200)
  approve(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('orderId') id: string,
    @Body(new ZodValidationPipe(ApproveOrderRequest)) body: ApproveOrderRequest,
  ): Promise<OrderDto> {
    return this.reviews.approve(ws, id, body.approve, user.userId);
  }

  @Get('order-settings')
  settings(@CurrentWorkspace() ws: WorkspaceId): Promise<OrderSettingsDto> {
    return this.orders.getSettings(ws);
  }

  @RequireCapability('settings.manage')
  @Put('order-settings')
  putSettings(
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ZodValidationPipe(OrderSettingsDto)) body: OrderSettingsDto,
  ): Promise<OrderSettingsDto> {
    return this.orders.putSettings(ws, body);
  }
}
