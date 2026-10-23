import { AppModule } from '../app.module.js';
import { createHttpApp, registerShutdown } from '../bootstrap.js';

const { app, env, logger } = await createHttpApp(AppModule);
await app.listen({ port: env.PORT, host: '0.0.0.0' });
registerShutdown(app, logger);
logger.info({ port: env.PORT, version: env.APP_VERSION }, 'api listening');
