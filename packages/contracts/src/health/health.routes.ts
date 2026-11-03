import { defineRoutes } from '../common/routes.js';
import { HealthResponse, ReadinessResponse } from './health.schema.js';

export const healthRoutes = defineRoutes([
  {
    method: 'get',
    path: '/health',
    summary: 'Liveness (never touches dependencies)',
    tag: 'health',
    auth: false,
    responses: { 200: HealthResponse },
  },
  {
    method: 'get',
    path: '/health/ready',
    summary: 'Readiness: 200 when every configured dependency answers, 503 otherwise',
    tag: 'health',
    auth: false,
    responses: { 200: ReadinessResponse, 503: ReadinessResponse },
  },
  {
    method: 'get',
    path: '/openapi.json',
    summary: 'This OpenAPI document',
    tag: 'meta',
    auth: false,
    responses: { 200: null },
  },
  {
    method: 'get',
    path: '/public/openapi.json',
    summary: 'The public API (routes callable with an API key, ADR-022)',
    tag: 'meta',
    auth: false,
    responses: { 200: null },
  },
]);
