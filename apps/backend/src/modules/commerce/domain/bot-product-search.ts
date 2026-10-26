import { foldVietnamese } from '@agent-sales/shared';

/** Words of a customer message that say nothing about which product is meant. */
const NOISE = new Set([
  'gia',
  'bao',
  'nhieu',
  'khong',
  'cho',
  'minh',
  'toi',
  'ban',
  'cua',
  'hang',
  'con',
  'co',
  'muon',
  'mua',
  // "show me the picture" requests and chat filler
  'xem',
  'anh',
  'hinh',
  'mau',
  'gui',
  'vay',
  'nhe',
  'shop',
]);

const MAX_SEARCHES = 14;

/**
 * The whole message plus its meaningful words: the catalog is searched once per entry. A merged
 * customer turn can carry several questions, so the cap leaves room for a product named late, or only in the bot's previous reply.
 */
export function botProductSearches(query: string): { searches: string[]; words: string[] } {
  const words = foldVietnamese(query)
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !NOISE.has(word));
  const searches = [...new Set([query.trim(), ...words])].filter(Boolean).slice(0, MAX_SEARCHES);
  return { searches, words };
}
