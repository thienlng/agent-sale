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
  llmProviders: ['admin', 'llm', 'providers'] as const,
  llmTiers: ['admin', 'llm', 'tiers'] as const,
};
