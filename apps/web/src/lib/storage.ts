/**
 * localStorage for per-browser conveniences (remembered workspace, locale).
 * Every access is guarded: private windows and blocked storage must not break the app.
 */
export const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignored: storage unavailable
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // ignored: storage unavailable
    }
  },
};
