import { DomainError } from '@agent-sales/shared';

export class ProductNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Product not found', { id });
  }
}

export class BotNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Bot not found', { id });
  }
}

export class WarehouseNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Warehouse not found', { id });
  }
}

export class OrderNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Order not found', { id });
  }
}

export class VariantNotFoundError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(ids: string[]) {
    super('Some products in the order no longer exist', { variantIds: ids });
  }
}

export class DuplicateCodeError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(field: 'code' | 'sku', value: string) {
    super(
      field === 'code'
        ? 'A product with this code already exists'
        : 'A variant with this SKU already exists',
      {
        field,
        value,
      },
    );
  }
}

export class WarehouseInUseError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(reason: 'default' | 'stock' | 'orders') {
    super(
      reason === 'default'
        ? 'The default warehouse cannot be deleted'
        : reason === 'stock'
          ? 'The warehouse still has stock'
          : 'The warehouse has orders',
      { reason },
    );
  }
}

export class InvalidOrderTransitionError extends DomainError {
  readonly code = 'CONFLICT';
}

export class OrderNoteRequiredError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(status: string) {
    super('A note is required for this status', { status });
  }
}

export class StatusDisabledError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(status: string) {
    super('This status is turned off in order settings', { status });
  }
}

export class NoWarehouseError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('Create a warehouse first');
  }
}

export class CommerceUnavailableError extends DomainError {
  readonly code = 'UNAVAILABLE';
  constructor() {
    super('Orders and products need a database (DATABASE_URL is not configured)');
  }
}

/** The same order draft was submitted twice at once; the caller returns the first order. */
export class DuplicateOrderRequestError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('This order was already submitted');
  }
}

/** The order's source policy requires fields the order leaves blank. */
export class OrderFieldsRequiredError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(stage: 'create' | 'confirm', source: string, fields: string[]) {
    super(
      stage === 'create'
        ? 'Fill in the fields this source requires to save an order'
        : 'Fill in the fields this source requires before the order is fulfilled',
      { stage, source, fields },
    );
  }
}

/**
 * Lines can change only while the order holds its goods (not once shipped, cancelled, returned or
 * pushed to a PMS); `PUSH_PENDING`: lines and amounts are frozen while a PMS push is pending.
 */
export class OrderItemsLockedError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(stockState: string, reason?: 'PUSH_PENDING') {
    super(
      reason
        ? 'The order is being sent to the PMS; its products and amounts cannot change now'
        : 'Products can only be changed while the order is still in the warehouse',
      reason ? { stockState, reason } : { stockState },
    );
  }
}

/** Order settings were saved by someone else since they were loaded. */
export class StaleSettingsError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('Order settings were changed by someone else; reload and try again');
  }
}

export class OrderDiscountError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('A percentage discount is at most 100');
  }
}

export class ShippingFeeRequiredError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('Send shippingFeeCharged when turning free shipping off');
  }
}

/** A product or gallery picture is not a file Rapiz stored for this workspace. */
export class ImageNotUploadedError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(field: string) {
    super('Upload the picture instead of linking to it', { reason: 'IMAGE_NOT_UPLOADED', field });
  }
}

/**
 * Media folders (`accommodation.albums`) are built by the lodging module for its bot product; a
 * catalog product cannot carry them, since their links and videos skip the picture checks (T-192).
 */
export class AlbumsLodgingOnlyError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('Media folders belong to lodging properties, not catalog products', {
      reason: 'ALBUMS_LODGING_ONLY',
      field: 'accommodation.albums',
    });
  }
}

/** Only orders the bot created carry a review. */
export class NotBotOrderError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('Only orders created by the bot can be approved', { reason: 'NOT_BOT_ORDER' });
  }
}

/** An approval can be taken back only by its reviewer, within a few seconds. */
export class ApprovalUndoNotAllowedError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('This approval can no longer be undone', { reason: 'UNDO_NOT_ALLOWED' });
  }
}

/** A product synced from a PMS: its linked fields and its stock are edited in the PMS (ADR-017). */
export class ExternalSourceLockedError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(field: string) {
    super('This product is synced from the PMS; change it there', {
      reason: 'EXTERNAL_SOURCE',
      field,
    });
  }
}

/** "Thử lại" applies only to an order whose push failed. */
export class OrderPushNotFailedError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(state: string | null) {
    super('Only a failed push can be retried', { reason: 'PUSH_NOT_FAILED', state });
  }
}
