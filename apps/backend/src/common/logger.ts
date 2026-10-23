import type { LoggerService } from '@nestjs/common';
import { pino, type Logger } from 'pino';

/** Structured JSON logs (docs/10 §4). Never log tokens or raw PII. */
export function createLogger(level: string): Logger {
  return pino({ level, base: { service: process.env['SERVICE_NAME'] ?? 'backend' } });
}

/** Adapts pino to Nest's LoggerService so framework logs are JSON too. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}
  log(message: unknown, context?: string) {
    this.logger.info({ context }, String(message));
  }
  error(message: unknown, trace?: string, context?: string) {
    this.logger.error({ context, trace }, String(message));
  }
  warn(message: unknown, context?: string) {
    this.logger.warn({ context }, String(message));
  }
  debug(message: unknown, context?: string) {
    this.logger.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string) {
    this.logger.trace({ context }, String(message));
  }
}
