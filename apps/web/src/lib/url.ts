/** `path?query` from an object, skipping empty values. */
export function withQuery(path: string, params: object): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' ? v !== '' : typeof v === 'number' || typeof v === 'boolean')
      q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
