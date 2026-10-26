import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { configureEnv } from '../common/config.js';
import { DbModule } from '../common/db/db.module.js';
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
let running = false;
const timer = setInterval(() => {
  if (running) return;
  running = true;
  void processor
    .tick()
    .catch(() => logger.error('Inbox queue claim failed'))
    .finally(() => {
      running = false;
    });
}, 300);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  // The interval keeps this worker alive; clearing it lets the process drain and exit.
  process.once(signal, () => clearInterval(timer));
logger.info('agent runtime started with durable Meta inbox processing');
