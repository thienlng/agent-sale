import { AssistantThreadDto } from '@agent-sales/contracts';

import { api } from '@/lib/api-client';

/**
 * The assistant thread about a report run (created on the first call). Its own file: the eager
 * bubble calls it for the bell's report notifications without pulling in the panel's API.
 */
export function openReportThread(ws: string, runId: string): Promise<AssistantThreadDto> {
  return api(`/assistant/schedule-runs/${runId}/thread`, AssistantThreadDto, {
    method: 'POST',
    body: {},
    workspaceId: ws,
  });
}
