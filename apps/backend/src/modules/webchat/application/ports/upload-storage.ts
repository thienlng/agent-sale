export interface WebchatUploadStorage {
  /** Whether object storage is configured; uploads answer 503 otherwise. */
  available(): boolean;
  /** Stores the bytes and returns the public https URL. Throws WebchatStorageUnavailableError. */
  put(key: string, bytes: Uint8Array, mime: string): Promise<string>;
  /** The public URL prefix every stored object lives under, or null when unconfigured. */
  publicPrefix(): string | null;
}
export const WEBCHAT_UPLOAD_STORAGE = Symbol('WEBCHAT_UPLOAD_STORAGE');
