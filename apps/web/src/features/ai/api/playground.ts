import {
  type PlaygroundImage,
  type PlaygroundMessage,
  PlaygroundResponse,
  REPLY_HISTORY_MAX_TURNS,
} from '@agent-sales/contracts';
import { useMutation } from '@tanstack/react-query';

import { api } from '@/lib/api-client';

export interface PlaygroundTurn {
  messages: PlaygroundMessage[];
  /** Images of the last customer message only; earlier turns' images are never resent. */
  images?: PlaygroundImage[] | undefined;
}

/** One test turn. Nothing is cached: every call is a fresh, metered reply. */
export function usePlayground(botId: string) {
  return useMutation({
    mutationFn: ({ messages, images }: PlaygroundTurn) =>
      api(`/bots/${botId}/playground`, PlaygroundResponse, {
        method: 'POST',
        body: {
          messages: messages.slice(-REPLY_HISTORY_MAX_TURNS),
          ...(images?.length ? { images } : {}),
        },
      }),
  });
}
