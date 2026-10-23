import { type PlaygroundMessage, PlaygroundResponse } from '@agent-sales/contracts';
import { useMutation } from '@tanstack/react-query';

import { api } from '@/lib/api-client';

/** One test turn. Nothing is cached: every call is a fresh, metered reply. */
export function usePlayground(botId: string) {
  return useMutation({
    mutationFn: (messages: PlaygroundMessage[]) =>
      api(`/bots/${botId}/playground`, PlaygroundResponse, {
        method: 'POST',
        body: { messages: messages.slice(-20) },
      }),
  });
}
