/** Lower-case, accent-free form of Vietnamese text, for matching what the owner typed. */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Up to about `max` characters of `content` around the first matching word of `query`. */
export function snippetAround(content: string, query: string, max = 200): string {
  const text = content.normalize('NFC');
  if (text.length <= max) return text;
  // NFC Vietnamese letters fold one-to-one, so a position in the folded text is (nearly) the
  // same position in the original; this only places a preview window.
  const word = foldText(query).split(/\s+/).find(Boolean) ?? '';
  const at = Math.max(0, foldText(text).indexOf(word));
  const start = Math.max(0, Math.min(at - Math.floor(max / 4), text.length - max));
  const body = text.slice(start, start + max).trim();
  return `${start > 0 ? '…' : ''}${body}${start + max < text.length ? '…' : ''}`;
}
