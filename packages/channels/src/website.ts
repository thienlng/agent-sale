import type { ChannelCapabilities } from './adapter.js';

export const WEBSITE_KIND = 'website' as const;

export const WEBSITE_CAPABILITIES: ChannelCapabilities = {
  richCards: false,
  quickReplies: true,
  media: true,
  replyWindowHours: null,
};
