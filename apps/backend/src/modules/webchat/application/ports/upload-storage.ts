export interface WebchatUploadStorage {
  /** Whether object storage is configured; uploads answer 503 otherwise. */
  available(): boolean;
  /** Stores the bytes and returns the public https URL. Throws WebchatStorageUnavailableError. */
  put(key: string, bytes: Uint8Array, mime: string): Promise<string>;
  /**
   * Copies a temporary upload to its permanent key once a message references it, and returns the
   * permanent public URL. Idempotent: when the temporary object is already gone but the permanent
   * one exists (a retried send), that one is returned. Throws WebchatStorageUnavailableError when
   * neither exists or storage fails.
   */
  promote(temporaryKey: string, key: string): Promise<string>;
  /** Deletes the objects under `prefix` last modified before `before`; returns how many. */
  purge(prefix: string, before: Date): Promise<number>;
  /** The public URL prefix every stored object lives under, or null when unconfigured. */
  publicPrefix(): string | null;
}
export const WEBCHAT_UPLOAD_STORAGE = Symbol('WEBCHAT_UPLOAD_STORAGE');
