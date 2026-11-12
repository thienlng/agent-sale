import {
  allRoutes,
  apiKeyRoutes,
  buildOpenApiDocument,
  type HealthResponse,
  type ReadinessResponse,
} from '@agent-sales/contracts';
import { Controller, Get, Header, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { getEnv } from '../../../../common/config.js';
import { Public } from '../../../../common/http/auth-context.js';
import { metricsRegistry } from '../../../../common/metrics.js';
import { CheckReadiness } from '../../application/check-readiness.js';

const startedAt = Date.now();
const version = process.env['APP_VERSION'] ?? '0.0.0-dev';

/**
 * Production hides internals from the public host: no build version on liveness and only the
 * public API (ADR-022) in /openapi.json. Readiness and /metrics are blocked at the edge
 * (infra/deploy/Caddyfile) and reached on the container network only.
 */
const isProduction = (): boolean => getEnv().NODE_ENV === 'production';

/** Operational endpoints: liveness, readiness, metrics, API description. */
@Public()
@Controller()
export class HealthController {
  constructor(@Inject(CheckReadiness) private readonly readiness: CheckReadiness) {}

  @Get('health')
  get(): HealthResponse {
    const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
    return isProduction()
      ? { status: 'ok', uptimeSeconds }
      : { status: 'ok', version, uptimeSeconds };
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

  /** The full internal route map outside production; the public API subset in production. */
  @Get('openapi.json')
  openapi(): Record<string, unknown> {
    if (isProduction()) return this.publicOpenapi();
    return buildOpenApiDocument(allRoutes, { title: 'Rapiz API', version });
  }

  /** The public API (ADR-022): only the routes a workspace API key may call. */
  @Get('public/openapi.json')
  publicOpenapi(): Record<string, unknown> {
    return buildOpenApiDocument(apiKeyRoutes(allRoutes), {
      title: 'Rapiz Public API',
      version: isProduction() ? '1' : version,
    });
  }
}
