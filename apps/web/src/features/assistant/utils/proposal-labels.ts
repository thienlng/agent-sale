/**
 * The owner-facing name of what a proposal runs, by its `routeKey` (`METHOD /path`). The card
 * shows "Thêm câu hỏi thường gặp", never `/bots/{botId}/faqs` (T-188). Keys are i18n keys under
 * `proposals.actions`; a route missing here falls back to `proposals.fallback.<verb>`.
 */
const ROUTE_LABELS: Readonly<Record<string, string>> = {
  'PATCH /conversations/{id}': 'conversationUpdate',
  'POST /conversations/{id}/notes': 'conversationNote',
  'PUT /conversations/{id}/contact': 'conversationContact',
  'POST /conversations/{id}/tags': 'conversationTag',
  'PATCH /workspace/profile': 'workspaceProfile',
  'POST /bots': 'botCreate',
  'PATCH /bots/{botId}': 'botUpdate',
  'POST /bots/{botId}/faqs': 'faqCreate',
  'POST /bots/{botId}/faqs/import': 'faqImport',
  'PATCH /bots/{botId}/faqs/{faqId}': 'faqUpdate',
  'DELETE /bots/{botId}/faqs/{faqId}': 'faqDelete',
  'POST /bots/{botId}/training-items': 'trainingCreate',
  'POST /bots/{botId}/training-items/starter-rules': 'trainingStarter',
  'PATCH /bots/{botId}/training-items/{itemId}': 'trainingUpdate',
  'DELETE /bots/{botId}/training-items/{itemId}': 'trainingDelete',
  'POST /bots/{botId}/training-history/{historyId}/restore': 'trainingRestore',
  'POST /bots/{botId}/actions': 'actionCreate',
  'PUT /bots/{botId}/products': 'botProducts',
  'POST /warehouses': 'warehouseCreate',
  'PATCH /warehouses/{warehouseId}': 'warehouseUpdate',
  'DELETE /warehouses/{warehouseId}': 'warehouseDelete',
  'POST /products': 'productCreate',
  'PUT /products/{productId}': 'productUpdate',
  'PATCH /products/{productId}/bot-settings': 'productBotSettings',
  'POST /products/{productId}/stock': 'productStock',
  'POST /orders': 'orderCreate',
  'PATCH /orders/{orderId}': 'orderUpdate',
  'POST /orders/{orderId}/status': 'orderStatus',
  'POST /orders/{orderId}/approve': 'orderApprove',
  'PUT /order-settings': 'orderSettings',
  'POST /stay-requests': 'stayRequestCreate',
  'PATCH /stay-requests/{id}/status': 'stayRequestStatus',
  'POST /lodging/properties': 'propertyCreate',
  'PATCH /lodging/properties/{id}': 'propertyUpdate',
  'PUT /lodging/properties/{id}/units': 'propertyUnits',
  'PUT /lodging/properties/{id}/rates': 'propertyRates',
  'POST /lodging/properties/{id}/overrides': 'overrideCreate',
  'PATCH /lodging/properties/{id}/overrides/{rateId}': 'overrideUpdate',
  'DELETE /lodging/properties/{id}/overrides/{rateId}': 'overrideDelete',
  'PUT /lodging/properties/{id}/notes': 'propertyNotes',
  'POST /lodging/bookings': 'bookingCreate',
  'PATCH /lodging/bookings/{id}': 'bookingUpdate',
  'POST /lodging/bookings/{id}/status': 'bookingStatus',
  'PATCH /lodging/settings': 'lodgingSettings',
  'PUT /lodging/bots/{botId}/properties': 'botProperties',
  'POST /contacts': 'contactCreate',
  'PATCH /contacts/{contactId}': 'contactUpdate',
  'POST /contacts/{contactId}/notes': 'contactNote',
  'PATCH /contacts/{contactId}/notes/{noteId}': 'contactNoteUpdate',
  'POST /contacts/{contactId}/tags': 'contactTag',
  'PATCH /tag-assignments/{assignmentId}': 'tagAssignmentUpdate',
  'POST /tag-assignments/{assignmentId}/remove': 'tagAssignmentRemove',
  'POST /crm/sources': 'sourceCreate',
  'PATCH /crm/sources/{optionId}': 'sourceUpdate',
  'PUT /crm/sources/order': 'sourceOrder',
  'POST /crm/statuses': 'statusCreate',
  'PATCH /crm/statuses/{optionId}': 'statusUpdate',
  'PUT /crm/statuses/order': 'statusOrder',
  'POST /crm/tags': 'tagCreate',
  'PATCH /crm/tags/{tagId}': 'tagUpdate',
  'PUT /crm/assignment-policies/{sourceId}': 'assignmentPolicy',
  'PUT /contacts/{id}/saas-subscription': 'saasSubscription',
  'POST /saas-plans': 'saasPlanCreate',
  'PATCH /saas-plans/{planId}': 'saasPlanUpdate',
  'POST /integrations/kiotviet/sync': 'kiotvietSync',
  'POST /integrations/kiotviet/orders/{orderId}/push': 'kiotvietPush',
};

const FALLBACK_VERBS = new Set(['post', 'patch', 'put', 'delete']);

/** The i18n key (in the `assistant` namespace) naming the action of `routeKey`. */
export function proposalLabelKey(routeKey: string): string {
  const key = routeKey.trim().replace(/\s+/g, ' ');
  const known = ROUTE_LABELS[key];
  if (known) return `proposals.actions.${known}`;
  const verb = key.split(' ')[0]?.toLowerCase() ?? '';
  return `proposals.fallback.${FALLBACK_VERBS.has(verb) ? verb : 'other'}`;
}

/** Every label key of the map: the i18n test checks both locales name each one. */
export const PROPOSAL_LABEL_KEYS: readonly string[] = [...new Set(Object.values(ROUTE_LABELS))];
