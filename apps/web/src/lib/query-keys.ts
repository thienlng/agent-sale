/**
 * Query keys shared across features, so a mutation in one feature (e.g. a FAQ
 * edit) can refresh data owned by another (the bot's readiness) without
 * importing it. Features never import each other (docs/ARCHITECTURE.md §4).
 */
export const queryKeys = {
  bots: (workspaceId: string) => ['ws', workspaceId, 'bots'] as const,
  bot: (workspaceId: string, botId: string) => ['ws', workspaceId, 'bots', botId] as const,
  readiness: (workspaceId: string, botId: string) =>
    ['ws', workspaceId, 'bots', botId, 'readiness'] as const,
  faqs: (workspaceId: string, botId: string) => ['ws', workspaceId, 'bots', botId, 'faqs'] as const,
  actions: (workspaceId: string, botId: string) =>
    ['ws', workspaceId, 'bots', botId, 'actions'] as const,
  warehouses: (ws: string) => ['ws', ws, 'warehouses'] as const,
  products: (ws: string) => ['ws', ws, 'products'] as const,
  product: (ws: string, id: string) => ['ws', ws, 'products', id] as const,
  variants: (ws: string) => ['ws', ws, 'variants'] as const,
  orders: (ws: string) => ['ws', ws, 'orders'] as const,
  order: (ws: string, id: string) => ['ws', ws, 'orders', 'detail', id] as const,
  orderSettings: (ws: string) => ['ws', ws, 'order-settings'] as const,
  contacts: (ws: string) => ['ws', ws, 'contacts'] as const,
  contact: (ws: string, id: string) => ['ws', ws, 'contacts', 'detail', id] as const,
  crmOptions: (ws: string, kind: 'sources' | 'statuses') => ['ws', ws, 'crm', kind] as const,
  crmTags: (ws: string) => ['ws', ws, 'crm', 'tags'] as const,
  crmAssignees: (ws: string) => ['ws', ws, 'crm', 'assignees'] as const,
  savedViews: (ws: string) => ['ws', ws, 'saved-views'] as const,
  llmProviders: ['admin', 'llm', 'providers'] as const,
  hermesLogin: (providerId: string) => ['admin', 'llm', 'hermes-login', providerId] as const,
  providerModels: (providerId: string) => ['admin', 'llm', 'models', providerId] as const,
  llmTiers: ['admin', 'llm', 'tiers'] as const,
};
