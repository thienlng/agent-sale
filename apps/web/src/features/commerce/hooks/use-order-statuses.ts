import { OPTIONAL_ORDER_STATUSES, OrderStatus } from '@agent-sales/contracts';

import { useOrderSettings } from '../api/commerce';

const OPTIONAL: ReadonlySet<string> = new Set(OPTIONAL_ORDER_STATUSES);

/** The statuses this shop uses, in flow order (optional ones only when switched on). */
export function useOrderStatuses() {
  const settings = useOrderSettings();
  const enabled = new Set<string>(settings.data?.extraStatuses ?? OPTIONAL_ORDER_STATUSES);
  const statuses = OrderStatus.options.filter((s) => !OPTIONAL.has(s) || enabled.has(s));
  return { statuses, requireNote: new Set<string>(settings.data?.requireNoteStatuses ?? []) };
}
