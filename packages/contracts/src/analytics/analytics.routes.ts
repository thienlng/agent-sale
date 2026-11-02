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
    assistant: {
      use: 'read',
      when: 'What each statistics metric means, before explaining numbers to the owner.',
    },
    summary: 'What every statistics metric means (versioned)',
    tag: 'analytics',
    auth: true,
    workspaceScoped: true,
    responses: { 200: DefinitionsResponse },
  },
  {
    method: 'post',
    path: '/analytics/query',
    assistant: {
      use: 'read',
      queryPost: true,
      when: 'Revenue, orders, customers and conversation statistics for a period, with series and breakdowns.',
    },
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
    assistant: {
      use: 'read',
      queryPost: true,
      when: 'The customers or conversations behind one statistics card, with the same filters.',
    },
    summary: 'The customers or conversations behind one card, with the same filters',
    tag: 'analytics',
    auth: true,
    workspaceScoped: true,
    body: DrilldownRequest,
    responses: { 200: DrilldownResponse },
  },
]);
