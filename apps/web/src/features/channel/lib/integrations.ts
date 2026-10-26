import type { ChannelConnectionDto, MetaProvider } from '@agent-sales/contracts';

/** Entries of the platform list on the integrations screens. */
export type PlatformKey =
  'all' | 'pending' | 'facebook' | 'instagram' | 'zalo' | 'lazada' | 'tiktok' | 'website';

export interface PlatformEntry {
  key: PlatformKey;
  /** Disabled entries are greyed out and cannot be selected. */
  disabled?: boolean;
}

/** Workspace inventory includes a category for pages with no assigned bot. */
export const WORKSPACE_PLATFORMS: readonly PlatformEntry[] = [
  { key: 'all' },
  { key: 'pending' },
  { key: 'facebook' },
  { key: 'instagram' },
  { key: 'zalo' },
  { key: 'lazada', disabled: true },
  { key: 'tiktok' },
];

/** Bot screen: every page shown already belongs to the bot, so there is no pending entry. */
export const BOT_PLATFORMS: readonly PlatformEntry[] = [
  { key: 'all' },
  { key: 'facebook' },
  { key: 'instagram' },
  { key: 'zalo' },
  { key: 'lazada', disabled: true },
  { key: 'tiktok' },
  { key: 'website', disabled: true },
];

export function isMetaProvider(key: PlatformKey): key is MetaProvider {
  return key === 'facebook' || key === 'instagram';
}

/** Platforms we list but cannot connect yet. */
export function isComingSoon(key: PlatformKey): boolean {
  return key === 'zalo' || key === 'lazada' || key === 'tiktok' || key === 'website';
}

export interface ConnectionFilter {
  category: PlatformKey;
  query: string;
  /** Bot mode: only pages bound to this bot. */
  botId?: string;
  /** Inventory assignment filter, independent of provider connectivity. */
  assignedBotId?: string | null;
}

export function filterConnections(
  connections: readonly ChannelConnectionDto[],
  { category, query, botId, assignedBotId }: ConnectionFilter,
): ChannelConnectionDto[] {
  const q = query.trim().toLowerCase();
  return connections.filter((c) => {
    if (botId !== undefined && c.botId !== botId) return false;
    if (assignedBotId !== undefined && c.botId !== assignedBotId) return false;
    if (category === 'pending' && c.botId !== null) return false;
    if (isMetaProvider(category) && c.provider !== category) return false;
    if (isComingSoon(category)) return false;
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.externalId.toLowerCase().includes(q);
  });
}

/** dd/MM/yyyy in the viewer's local time, as on the reference screens. */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? '';
  const last = words.length > 1 ? (words.at(-1) ?? '') : '';
  const letters = last ? `${first.charAt(0)}${last.charAt(0)}` : first.slice(0, 2);
  return letters.toUpperCase() || '?';
}

export interface BotPagesPlan {
  /** Pages to bind to the bot (PATCH botId). */
  bind: ChannelConnectionDto[];
  /** Pages to release from the bot (PATCH botId: null). */
  unbind: ChannelConnectionDto[];
  /** Subset of `bind` currently answered by another bot (needs confirmation). */
  moved: ChannelConnectionDto[];
}

/** Diff between the pages checked in the bot dialog and the current bindings. */
export function planBotPages(
  connections: readonly ChannelConnectionDto[],
  botId: string,
  checked: ReadonlySet<string>,
): BotPagesPlan {
  const bind = connections.filter((c) => checked.has(c.id) && c.botId !== botId);
  const unbind = connections.filter((c) => !checked.has(c.id) && c.botId === botId);
  return { bind, unbind, moved: bind.filter((c) => c.botId !== null) };
}
