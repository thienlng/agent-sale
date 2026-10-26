/** What the inbox asks of the tag library: who has which tags. All ids are tag ids. */
export interface TagFilter {
  /** Has at least one of these. */
  any?: readonly string[] | undefined;
  /** Has every one of these. */
  all?: readonly string[] | undefined;
  /** Has none of these. */
  exclude?: readonly string[] | undefined;
  /** Has no tag at all. */
  untagged?: boolean | undefined;
}

export interface TagFilterResult {
  /** Only these entities may match; `null` when no filter narrows the set. */
  include: string[] | null;
  /** None of these may match. */
  exclude: string[];
}

/**
 * Turns the filter into id sets the caller applies to its own table (the library does not know
 * the entities that have no tag). `pairs` are the active assignments of the tags the filter
 * names; `taggedAny` are the entities with any active tag (only read for `untagged`).
 */
export function resolveTagFilter(
  filter: TagFilter,
  pairs: readonly { entityId: string; tagId: string }[],
  taggedAny: ReadonlySet<string>,
): TagFilterResult {
  const tagsOf = new Map<string, Set<string>>();
  for (const p of pairs) {
    const set = tagsOf.get(p.entityId) ?? new Set<string>();
    set.add(p.tagId);
    tagsOf.set(p.entityId, set);
  }
  const any = filter.any ?? [];
  const all = filter.all ?? [];
  const exclude = filter.exclude ?? [];
  let include: string[] | null = null;
  if (any.length || all.length)
    include = [...tagsOf]
      .filter(
        ([, tags]) =>
          (!any.length || any.some((t) => tags.has(t))) && all.every((t) => tags.has(t)),
      )
      .map(([id]) => id);
  const excluded = new Set<string>();
  for (const [id, tags] of tagsOf) if (exclude.some((t) => tags.has(t))) excluded.add(id);
  if (filter.untagged) for (const id of taggedAny) excluded.add(id);
  return { include, exclude: [...excluded] };
}
