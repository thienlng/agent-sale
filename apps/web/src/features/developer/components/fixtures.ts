import type { ApiKeyDto, WebhookDeliveryDto, WebhookEndpointDto } from '@agent-sales/contracts';

const at = '2026-11-01T08:00:00.000Z';

export function apiKey(over: Partial<ApiKeyDto> = {}): ApiKeyDto {
  return {
    id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9b01',
    name: 'ERP sync',
    prefix: 'rpz_live_abcdefghijkl',
    scopes: ['contacts.view', 'orders.view'],
    status: 'active',
    createdBy: { userId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9b02', name: 'Lan' },
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: at,
    ...over,
  };
}

export function endpoint(over: Partial<WebhookEndpointDto> = {}): WebhookEndpointDto {
  return {
    id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9b11',
    url: 'https://erp.example.com/hooks/rapiz',
    description: 'ERP',
    events: ['crm.contact.created', 'commerce.order.created'],
    enabled: true,
    disabledReason: null,
    failingSince: null,
    previousSecretExpiresAt: null,
    version: 3,
    createdAt: at,
    updatedAt: at,
    ...over,
  };
}

export function delivery(over: Partial<WebhookDeliveryDto> = {}): WebhookDeliveryDto {
  return {
    id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9b21',
    endpointId: endpoint().id,
    eventId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9b22',
    eventType: 'crm.contact.created',
    status: 'failed',
    attempts: 8,
    nextAttemptAt: null,
    lastStatusCode: 500,
    lastError: 'Internal Server Error',
    deliveredAt: null,
    createdAt: at,
    payload: { id: 'evt', type: 'crm.contact.created' },
    ...over,
  };
}
