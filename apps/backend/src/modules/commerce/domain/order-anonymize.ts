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
