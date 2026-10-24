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
  warehouses: (ws: string) => ['ws', ws, 'warehouses'] as const,
  products: (ws: string) => ['ws', ws, 'products'] as const,
  product: (ws: string, id: string) => ['ws', ws, 'products', id] as const,
  variants: (ws: string) => ['ws', ws, 'variants'] as const,
  orders: (ws: string) => ['ws', ws, 'orders'] as const,
  order: (ws: string, id: string) => ['ws', ws, 'orders', 'detail', id] as const,
  orderSettings: (ws: string) => ['ws', ws, 'order-settings'] as const,
  llmProviders: ['admin', 'llm', 'providers'] as const,
  llmTiers: ['admin', 'llm', 'tiers'] as const,
};
