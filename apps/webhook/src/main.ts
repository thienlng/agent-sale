import { ChannelRegistry } from '@agent-sales/channels';

import { buildServer } from './server.js';

// Adapters, the Postgres store and the BullMQ queue are wired here as they land
// (channels: T-003 follow-ups; store: T-004). Until then the process boots with
// an empty registry so deploy tooling can be exercised.
const registry = new ChannelRegistry();
const app = buildServer({
  registry,
  store: { storeOnce: async () => true },
  queue: { enqueue: async () => undefined },
  secrets: {},
  logLevel: process.env['LOG_LEVEL'] ?? 'info',
});

const port = Number(process.env['PORT'] ?? 3001);
await app.listen({ port, host: '0.0.0.0' });
