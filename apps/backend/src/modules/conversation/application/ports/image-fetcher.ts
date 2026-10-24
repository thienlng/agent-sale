import type { ImageInput } from '@agent-sales/ai-core';

export const IMAGE_FETCHER = Symbol('IMAGE_FETCHER');

/**
 * Downloads one customer image for the model. Returns null on ANY failure (blocked host, timeout,
 * wrong type, too large…): callers degrade to the text-only behaviour and never fail the job.
 */
export interface ImageFetcher {
  fetch(url: string): Promise<ImageInput | null>;
}

/** Whether the bot looks at customer images (`BOT_IMAGE_VISION`). */
export const BOT_IMAGE_VISION = Symbol('BOT_IMAGE_VISION');
