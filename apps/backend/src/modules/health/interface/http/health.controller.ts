import type { HealthResponse } from '@agent-sales/contracts';
import { Controller, Get } from '@nestjs/common';

const startedAt = Date.now();

@Controller('health')
export class HealthController {
  @Get()
  get(): HealthResponse {
    return {
      status: 'ok',
      version: process.env['APP_VERSION'] ?? '0.0.0-dev',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    };
  }
}
