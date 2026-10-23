import { HealthResponse, ReadinessResponse } from '@agent-sales/contracts';
import type { FastifyReply } from 'fastify';
import { describe, expect, it } from 'vitest';

import { CheckReadiness } from '../../application/check-readiness.js';
import type { ReadinessProbe } from '../../application/ports/readiness-probe.js';
import { HealthController } from './health.controller.js';

function probe(name: string, status: 'up' | 'down' | 'skipped'): ReadinessProbe {
  return { name, check: async () => ({ name, status }) };
}

function fakeReply() {
  const r = {
    code: 200,
    status(c: number) {
      r.code = c;
      return r;
    },
  };
  return r;
}

describe('HealthController', () => {
  it('liveness matches the contract', () => {
    const body = new HealthController(new CheckReadiness([])).get();
    expect(HealthResponse.parse(body).status).toBe('ok');
  });

  it('is ready when probes are up or skipped', async () => {
    const reply = fakeReply();
    const body = await new HealthController(
      new CheckReadiness([probe('postgres', 'up'), probe('redis', 'skipped')]),
    ).ready(reply as unknown as FastifyReply);
    expect(ReadinessResponse.parse(body).status).toBe('ready');
    expect(reply.code).toBe(200);
  });

  it('answers 503 when any probe is down', async () => {
    const reply = fakeReply();
    const body = await new HealthController(new CheckReadiness([probe('postgres', 'down')])).ready(
      reply as unknown as FastifyReply,
    );
    expect(body.status).toBe('not_ready');
    expect(reply.code).toBe(503);
  });
});
