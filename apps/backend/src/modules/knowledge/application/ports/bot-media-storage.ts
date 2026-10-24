export interface BotMediaStorage {
  put(key: string, content: Uint8Array, mimeType: string): Promise<string>;
  remove(key: string): Promise<void>;
}
export const BOT_MEDIA_STORAGE = Symbol('BOT_MEDIA_STORAGE');
