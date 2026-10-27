/** Defensive storage: every access is try/catch; without storage the widget works for the page session only. */

const memory: Record<string, string> = {};

export function readItem(key: string): string | null {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? (memory[key] ?? null) : v;
  } catch {
    return memory[key] ?? null;
  }
}

export function writeItem(key: string, value: string): void {
  memory[key] = value;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: memory only */
  }
}

export function removeItem(key: string): void {
  delete memory[key];
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export const tokenKey = (siteKey: string): string => `rapiz_v_${siteKey}`;
export const muteKey = (siteKey: string): string => `rapiz_mute_${siteKey}`;
export const firstUrlKey = (siteKey: string): string => `rapiz_first_${siteKey}`;
