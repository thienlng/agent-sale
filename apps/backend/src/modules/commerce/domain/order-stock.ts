import { InvalidOrderTransitionError } from './commerce.errors.js';

export type OrderStatus =
  | 'new'
  | 'awaiting_confirmation'
  | 'ordered'
  | 'confirmed'
  | 'packing'
  | 'awaiting_print'
  | 'printed'
  | 'awaiting_handover'
  | 'delivering'
  | 'delivered'
  | 'delivery_failed'
  | 'returning'
  | 'returned'
  | 'cancelled';

/** Where an order's goods are. */
export type StockState = 'reserved' | 'shipped' | 'released' | 'returned';

/** What has to happen to inventory for a status change. */
export type StockAction = 'reserve' | 'release' | 'ship' | 'return';

const SHIPPED: ReadonlySet<OrderStatus> = new Set([
  'delivering',
  'delivered',
  'delivery_failed',
  'returning',
]);

/** The stock state an order must be in for a status. */
function requiredState(status: OrderStatus): StockState {
  if (status === 'cancelled') return 'released';
  if (status === 'returned') return 'returned';
  if (SHIPPED.has(status)) return 'shipped';
  return 'reserved';
}

/**
 * Inventory rules for order statuses (docs/05 §6):
 * - a live order holds its goods (`reserved`: inventory.reserved += qty);
 * - entering a shipped status takes them out (`ship`: on_hand −= qty, reserved −= qty);
 * - `cancelled` gives held goods back (`release`); goods already out must come
 *   back as `returned` (`return`: on_hand += qty), not be cancelled;
 * - a cancelled or returned order can be revived, which reserves again.
 * Returns the actions to apply in order, and the new state.
 */
export function stockTransition(
  current: StockState,
  to: OrderStatus,
): { next: StockState; actions: StockAction[] } {
  const target = requiredState(to);
  if (current === target) return { next: current, actions: [] };

  switch (`${current}->${target}`) {
    case 'reserved->shipped':
      return { next: 'shipped', actions: ['ship'] };
    case 'reserved->released':
      return { next: 'released', actions: ['release'] };
    case 'reserved->returned':
      // Nothing left the warehouse: a "return" before shipping is just giving the hold back.
      return { next: 'released', actions: ['release'] };
    case 'shipped->returned':
      return { next: 'returned', actions: ['return'] };
    case 'shipped->reserved':
      // Back from the carrier into the shop (e.g. delivery failed → re-pack): counted back in, held again.
      return { next: 'reserved', actions: ['return', 'reserve'] };
    case 'released->reserved':
    case 'returned->reserved':
      return { next: 'reserved', actions: ['reserve'] };
    case 'released->shipped':
    case 'returned->shipped':
      return { next: 'shipped', actions: ['reserve', 'ship'] };
    case 'shipped->released':
      throw new InvalidOrderTransitionError(
        'Goods have already left the warehouse: mark the order as returning or returned instead of cancelled',
      );
    case 'released->returned':
      // Marked returned while nothing was held or out: nothing moves.
      return { next: 'released', actions: [] };
    case 'returned->released':
      // A returned order cancelled afterwards: the goods are already back.
      return { next: 'released', actions: [] };
    default:
      throw new Error(`unhandled stock transition ${current} -> ${target}`);
  }
}
