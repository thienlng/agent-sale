import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { configureEnv } from '../common/config.js';
import { DbModule } from '../common/db/db.module.js';
import { startIngressListener } from '../common/db/ingress-listener.js';
import { createTickScheduler } from '../common/db/tick-scheduler.js';
import { createLogger, PinoNestLogger } from '../common/logger.js';
import { ConversationModule } from '../modules/conversation/conversation.module.js';
import { CONVERSATION_RUNNER, type ConversationRunner } from '../modules/conversation/api/index.js';
@Module({ imports: [DbModule, ConversationModule] })
class AgentModule {}
const env = configureEnv();
const logger = createLogger(env.LOG_LEVEL);
const ctx = await NestFactory.createApplicationContext(AgentModule, {
  logger: new PinoNestLogger(logger),
});
ctx.enableShutdownHooks();
const processor = ctx.get<ConversationRunner>(CONVERSATION_RUNNER);
// Ticks run on LISTEN/NOTIFY wake-ups; the poll is a safety net (300 ms while the listener is down).
const scheduler = createTickScheduler({
  tick: () => processor.tick(),
  onError: () => logger.error('Inbox queue claim failed'),
});
const listenUrl = env.DATABASE_LISTEN_URL ?? env.DATABASE_SYSTEM_URL;
const listener = listenUrl
  ? startIngressListener({
      url: listenUrl,
      channel: 'rapiz_ingress',
      onNotify: () => scheduler.wake(),
      onState: (up) => {
        logger.info(up ? 'ingress listener up' : 'ingress listener down, polling fast');
        scheduler.setListenerUp(up);
      },
      backoff: { minMs: 1_000, maxMs: 30_000 },
    })
  : undefined;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  // The timers keep this worker alive; stopping them lets the process drain and exit.
  process.once(signal, () => {
    scheduler.stop();
    void listener?.stop();
  });
logger.info('agent runtime started with durable Meta inbox processing');
