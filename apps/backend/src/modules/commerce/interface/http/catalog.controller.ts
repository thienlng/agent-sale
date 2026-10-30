import {
  AdjustStockRequest,
  type BotProductsDto,
  type ProductDto,
  ProductListQuery,
  type ProductListResponse,
  SetBotProductsRequest,
  UploadProductImageRequest,
  type UploadProductImageResponse,
  UpsertProductRequest,
  UpsertWarehouseRequest,
  type VariantOption,
  VariantSearchQuery,
  type WarehouseDto,
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
import { RouteConfig } from '@nestjs/platform-fastify';
import type { z } from 'zod';

import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { InvalidImageError } from '../../../../common/storage/image-bytes.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { CatalogService } from '../../application/catalog.service.js';
import { LodgingService } from '../../application/lodging.service.js';
import { ProductImageService } from '../../application/product-image.service.js';

/** Thin controller: warehouses, products and the variant picker. */
@WorkspaceScoped()
/** WebP (or any other type) gets the same INVALID_IMAGE answer as bad bytes; the rest is Zod. */
class ProductImageBodyPipe extends ZodValidationPipe<UploadProductImageRequest> {
  constructor() {
    super(UploadProductImageRequest);
  }

  override transform(value: unknown): UploadProductImageRequest {
    const mime = (value as { mimeType?: unknown } | null)?.mimeType;
    if (typeof mime === 'string' && mime !== 'image/jpeg' && mime !== 'image/png')
      throw new InvalidImageError();
    return super.transform(value);
  }
}

@Controller()
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(LodgingService) private readonly lodging: LodgingService,
    @Inject(ProductImageService) private readonly images: ProductImageService,
  ) {}

  @Get('warehouses')
  async warehouses(@CurrentWorkspace() ws: WorkspaceId): Promise<{ data: WarehouseDto[] }> {
    return { data: await this.catalog.listWarehouses(ws) };
  }

  @RequireCapability('catalog.manage')
  @Post('warehouses')
  @HttpCode(201)
  createWarehouse(
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ZodValidationPipe(UpsertWarehouseRequest)) body: UpsertWarehouseRequest,
  ): Promise<WarehouseDto> {
    return this.catalog.createWarehouse(ws, body);
  }

  @RequireCapability('catalog.manage')
  @Patch('warehouses/:warehouseId')
  updateWarehouse(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('warehouseId') id: string,
    @Body(new ZodValidationPipe(UpsertWarehouseRequest)) body: UpsertWarehouseRequest,
  ): Promise<WarehouseDto> {
    return this.catalog.updateWarehouse(ws, id, body);
  }

  @RequireCapability('catalog.manage')
  @Delete('warehouses/:warehouseId')
  @HttpCode(204)
  deleteWarehouse(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('warehouseId') id: string,
  ): Promise<void> {
    return this.catalog.deleteWarehouse(ws, id);
  }

  @Get('products')
  products(
    @CurrentWorkspace() ws: WorkspaceId,
    @Query(new ZodValidationPipe(ProductListQuery)) query: z.infer<typeof ProductListQuery>,
  ): Promise<ProductListResponse> {
    return this.catalog.listProducts(ws, query);
  }

  @RequireCapability('catalog.manage')
  @Post('products')
  @HttpCode(201)
  async createProduct(
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ZodValidationPipe(UpsertProductRequest)) body: UpsertProductRequest,
  ): Promise<ProductDto> {
    if (body.accommodation) await this.lodging.assertHotel(ws);
    return this.catalog.createProduct(ws, body);
  }

  @RequireCapability('catalog.manage')
  @Post('products/images')
  @HttpCode(201)
  @RouteConfig({ bodyLimit: 2_097_152 })
  uploadProductImage(
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ProductImageBodyPipe()) body: UploadProductImageRequest,
  ): Promise<UploadProductImageResponse> {
    return this.images.upload(ws, body);
  }

  @Get('products/:productId')
  product(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('productId') id: string,
  ): Promise<ProductDto> {
    return this.catalog.getProduct(ws, id);
  }

  @RequireCapability('catalog.manage')
  @Put('products/:productId')
  async updateProduct(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('productId') id: string,
    @Body(new ZodValidationPipe(UpsertProductRequest)) body: UpsertProductRequest,
  ): Promise<ProductDto> {
    if (body.accommodation) await this.lodging.assertHotel(ws);
    return this.catalog.updateProduct(ws, id, body);
  }

  @RequireCapability('catalog.manage')
  @Post('products/:productId/stock')
  @HttpCode(200)
  adjustStock(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('productId') id: string,
    @Body(new ZodValidationPipe(AdjustStockRequest)) body: AdjustStockRequest,
  ): Promise<ProductDto> {
    return this.catalog.adjustStock(ws, id, body, user.userId);
  }

  @Get('bots/:botId/products')
  botProducts(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('botId') botId: string,
  ): Promise<BotProductsDto> {
    return this.catalog.listBotProducts(ws, botId);
  }

  @RequireCapability('catalog.manage')
  @Put('bots/:botId/products')
  setBotProducts(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('botId') botId: string,
    @Body(new ZodValidationPipe(SetBotProductsRequest)) body: SetBotProductsRequest,
  ): Promise<BotProductsDto> {
    return this.catalog.setBotProducts(ws, botId, body);
  }

  @Get('product-variants')
  async variants(
    @CurrentWorkspace() ws: WorkspaceId,
    @Query(new ZodValidationPipe(VariantSearchQuery)) query: z.infer<typeof VariantSearchQuery>,
  ): Promise<{ data: VariantOption[] }> {
    return { data: await this.catalog.searchVariants(ws, query) };
  }
}
