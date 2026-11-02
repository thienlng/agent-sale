/** Integration events published by commerce. Payload schemas live in packages/contracts/src/commerce/. */
export const COMMERCE_EVENT_TYPES = [
  'commerce.order.created.v1',
  'commerce.order.status_changed.v1',
] as const;
