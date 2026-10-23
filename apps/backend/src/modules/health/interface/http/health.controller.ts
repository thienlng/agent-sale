import {
  allRoutes,
  buildOpenApiDocument,
  type HealthResponse,
  type ReadinessResponse,
} from '@agent-sales/contracts';
import { Controller, Get, Header, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { Public } from '../../../../common/http/auth-context.js';
import { metricsRegistry } from '../../../../common/metrics.js';
import { CheckReadiness } from '../../application/check-readiness.js';

const startedAt = Date.now();
const version = process.env['APP_VERSION'] ?? '0.0.0-dev';

/** Operational endpoints: liveness, readiness, metrics, API description. */
@Public()
@Controller()
export class HealthController {
  constructor(@Inject(CheckReadiness) private readonly readiness: CheckReadiness) {}

  @Get('health')
  get(): HealthResponse {
    return { status: 'ok', version, uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) };
  }

  @Get('health/ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<ReadinessResponse> {
    const result = await this.readiness.execute();
    if (result.status !== 'ready') void reply.status(503);
    return result;
  }

  /** Prometheus scrape endpoint; excluded from the /api/v1 prefix. */
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  metrics(): Promise<string> {
    return metricsRegistry.metrics();
  }

  @Get('openapi.json')
  openapi(): Record<string, unknown> {
    return buildOpenApiDocument(allRoutes, { title: 'Razpi API', version });
  }
}
