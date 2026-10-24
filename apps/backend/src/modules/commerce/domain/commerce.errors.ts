import { DomainError } from '@agent-sales/shared';

export class ProductNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Product not found', { id });
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
