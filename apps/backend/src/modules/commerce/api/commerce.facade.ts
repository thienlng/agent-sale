import type { OrderDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** PUBLIC CONTRACT of the commerce module (inbox and bot use it from M3). */
export interface CommerceFacade {
  /** Throws NOT_FOUND when the order does not exist in the workspace. */
  getOrder(workspaceId: WorkspaceId, orderId: string): Promise<OrderDto>;
}

export const COMMERCE_FACADE = Symbol('COMMERCE_FACADE');
