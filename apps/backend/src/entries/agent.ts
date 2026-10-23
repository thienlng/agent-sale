import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { loadEnv } from '../common/config.js';
import { createLogger, PinoNestLogger } from '../common/logger.js';

/**
 * Agent entry: the ONLY process that calls LLM providers (via @agent-sales/ai-core).
 * Consumes the `conversation` and `conversation:priority` queues; the `ai`
 * module's application/jobs are registered here (T-007 onward).
 */
@Module({ imports: [] })
class AgentModule {}

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const ctx = await NestFactory.createApplicationContext(AgentModule, {
  logger: new PinoNestLogger(logger),
});
ctx.enableShutdownHooks();
logger.info('agent runtime started (no processors registered yet)');
