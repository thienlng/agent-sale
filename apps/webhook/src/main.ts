import { ChannelRegistry, MetaAdapter } from '@agent-sales/channels';
import { createDb } from '@agent-sales/db';
import { MetaIngressStore } from './infrastructure/meta-ingress.store.js';
import { buildServer } from './server.js';
const url = process.env['DATABASE_SYSTEM_URL'];
if (!url) throw new Error('DATABASE_SYSTEM_URL is required for durable webhook ingress');
const handle = createDb({ url });
const registry = new ChannelRegistry()
  .register(new MetaAdapter('facebook'))
  .register(new MetaAdapter('instagram'));
const app = buildServer({
  registry,
  store: new MetaIngressStore(handle.db),
  // The database event row is the durable queue; the agent claims it even after a process crash.
  queue: { enqueue: async () => undefined },
  secrets: {
    facebook: process.env['META_APP_SECRET'] ?? '',
    instagram: process.env['INSTAGRAM_APP_SECRET'] ?? '',
  },
  verifyToken: process.env['META_WEBHOOK_VERIFY_TOKEN'] ?? '',
  logLevel: process.env['LOG_LEVEL'] ?? 'info',
});
app.addHook('onClose', async () => handle.close());
await app.listen({ port: Number(process.env['PORT'] ?? 3001), host: '0.0.0.0' });
