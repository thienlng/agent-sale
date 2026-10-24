/** Order fields a source's policy can require (mirrors ORDER_POLICY_FIELDS in contracts). */
export type PolicyField = 'customerPhone' | 'customerEmail' | 'recipientPhone' | 'recipientAddress';

export interface OrderPeople {
  customer: { phone?: unknown; email?: unknown };
  recipient: { phone?: unknown; address?: unknown };
}

const present = (v: unknown) => typeof v === 'string' && v.trim() !== '';

const VALUE: Record<PolicyField, (o: OrderPeople) => unknown> = {
  customerPhone: (o) => o.customer.phone,
  customerEmail: (o) => o.customer.email,
  recipientPhone: (o) => o.recipient.phone,
  recipientAddress: (o) => o.recipient.address,
};

/** The required fields an order leaves blank, in a stable order. */
export function missingFields(order: OrderPeople, required: readonly PolicyField[]): PolicyField[] {
  return (Object.keys(VALUE) as PolicyField[]).filter(
    (f) => required.includes(f) && !present(VALUE[f](order)),
  );
}
