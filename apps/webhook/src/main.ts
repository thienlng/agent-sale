import { isIP } from 'node:net';

import { ChannelRegistry, MetaAdapter } from '@agent-sales/channels';
import { createDb } from '@agent-sales/db';
import { parseTrustProxy } from '@agent-sales/shared';
import { DrizzleKiotVietIngressStore } from './infrastructure/kiotviet-ingress.store.js';
import { DrizzleMetaDataDeletionStore } from './infrastructure/meta-data-deletion.store.js';
import { MetaIngressStore } from './infrastructure/meta-ingress.store.js';
import { buildServer } from './server.js';
const url = process.env['DATABASE_SYSTEM_URL'];
if (!url) throw new Error('DATABASE_SYSTEM_URL is required for durable webhook ingress');
const handle = createDb({ url });
const metaAppSecret = process.env['META_APP_SECRET'] ?? '';
// The status link Meta shows the person points at the dashboard's public page.
const statusOrigin = process.env['APP_PUBLIC_URL'] ?? '';
const registry = new ChannelRegistry()
  .register(new MetaAdapter('facebook'))
  .register(new MetaAdapter('instagram'));
const app = buildServer({
  registry,
  store: new MetaIngressStore(handle.db),
  // The database event row is the durable queue; the agent claims it even after a process crash.
  queue: { enqueue: async () => undefined },
  secrets: {
    facebook: metaAppSecret,
    instagram: process.env['INSTAGRAM_APP_SECRET'] ?? '',
  },
  verifyToken: process.env['META_WEBHOOK_VERIFY_TOKEN'] ?? '',
  kiotviet: new DrizzleKiotVietIngressStore(handle.db),
  ...(metaAppSecret && statusOrigin.startsWith('https://')
    ? {
        metaDataDeletion: {
          store: new DrizzleMetaDataDeletionStore(handle.db),
          appSecret: metaAppSecret,
          statusOrigin,
        },
      }
    : {}),
  logLevel: process.env['LOG_LEVEL'] ?? 'info',
  trustProxy: parseTrustProxy(process.env['TRUST_PROXY'], process.env['NODE_ENV'], isIP),
});
app.addHook('onClose', async () => handle.close());
await app.listen({ port: Number(process.env['PORT'] ?? 3001), host: '0.0.0.0' });
