/** A name compared loosely: NFC, trimmed, inner spaces collapsed, case-insensitive. */
export function sameName(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) =>
    typeof v === 'string'
      ? v.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi')
      : '';
  return norm(a) === norm(b);
}

/**
 * Whether an order found for a deleted customer is theirs (docs/09 §10). An order of one of their
 * conversations is. An order found only by the phone typed on it is theirs when its customer name
 * is the customer's or empty: staff type orders with a phone a family or a front desk shares, and
 * another person's order with that phone must stay.
 */
export function isDeletedCustomersOrder(
  order: { conversationId: string | null; customer: Record<string, unknown> },
  conversationIds: readonly string[],
  contactName: string | null,
): boolean {
  if (order.conversationId && conversationIds.includes(order.conversationId)) return true;
  const name = order.customer.name;
  if (typeof name !== 'string' || !name.trim()) return true;
  return sameName(name, contactName);
}

/**
 * The customer snapshot of an order whose customer was deleted on request (docs/09 §10): the order
 * stays a business record, the person goes. The customer keeps only the placeholder name; the
 * recipient is anonymized the same way when it is the same person (the customer's phone, or no
 * phone of its own), otherwise (a gift to someone else) it stays as entered.
 */
export function anonymizeOrderPeople(
  order: { customer: Record<string, unknown>; recipient: Record<string, unknown> },
  customerPhones: readonly string[],
  placeholder: string,
): { customer: Record<string, unknown>; recipient: Record<string, unknown> } {
  const digits = (v: unknown) => (typeof v === 'string' ? v.replace(/\D/g, '') : '');
  const customerDigits = digits(order.customer.phone);
  const recipientDigits = digits(order.recipient.phone);
  const samePerson =
    !recipientDigits ||
    recipientDigits === customerDigits ||
    customerPhones.includes(recipientDigits) ||
    order.recipient.name === order.customer.name;
  return {
    customer: { name: placeholder },
    recipient: samePerson ? { name: placeholder } : order.recipient,
  };
}
