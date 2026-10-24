import {
  defaultOrderPolicy,
  FULFILMENT_ORDER_STATUSES,
  OPTIONAL_ORDER_STATUSES,
  type OrderPolicyField,
  type OrderSource,
  OrderStatus,
} from '@agent-sales/contracts';

import { useOrderSettings } from '../api/commerce';

const OPTIONAL: ReadonlySet<string> = new Set(OPTIONAL_ORDER_STATUSES);

/** The statuses this shop uses, in flow order (optional ones only when switched on). */
export function useOrderStatuses() {
  const settings = useOrderSettings();
  const enabled = new Set<string>(settings.data?.extraStatuses ?? OPTIONAL_ORDER_STATUSES);
  const statuses = OrderStatus.options.filter((s) => !OPTIONAL.has(s) || enabled.has(s));
  return { statuses, requireNote: new Set<string>(settings.data?.requireNoteStatuses ?? []) };
}

const FULFILMENT: ReadonlySet<string> = new Set(FULFILMENT_ORDER_STATUSES);

/**
 * Fields the server will require for an order from `source` saved in `status`:
 * the source's creation fields, plus its confirmation fields for fulfilment statuses.
 */
export function useRequiredOrderFields(
  source: OrderSource,
  status: OrderStatus,
): ReadonlySet<OrderPolicyField> {
  const settings = useOrderSettings();
  const policy =
    settings.data?.policies.find((p) => p.source === source) ?? defaultOrderPolicy(source);
  return new Set([...policy.create, ...(FULFILMENT.has(status) ? policy.confirm : [])]);
}
