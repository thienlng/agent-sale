import { defineRoutes } from '../common/routes.js';
import {
  AnalyticsQuery,
  AnalyticsResponse,
  DefinitionsResponse,
  DrilldownRequest,
  DrilldownResponse,
} from './analytics.schema.js';

export const analyticsRoutes = defineRoutes([
  {
    method: 'get',
    path: '/analytics/definitions',
    summary: 'What every statistics metric means (versioned)',
    tag: 'analytics',
    auth: true,
    workspaceScoped: true,
    responses: { 200: DefinitionsResponse },
  },
  {
    method: 'post',
    path: '/analytics/query',
    summary: 'Statistics cards, series and breakdowns for one set of filters',
    tag: 'analytics',
    auth: true,
    workspaceScoped: true,
    body: AnalyticsQuery,
    responses: { 200: AnalyticsResponse },
  },
  {
    method: 'post',
    path: '/analytics/drilldown',
    summary: 'The customers or conversations behind one card, with the same filters',
    tag: 'analytics',
    auth: true,
    workspaceScoped: true,
    body: DrilldownRequest,
    responses: { 200: DrilldownResponse },
  },
]);
