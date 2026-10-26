/**
 * The profile refreshed under an open form (a logo upload returns the whole profile, a save
 * returns the new version): take the new value of every field the user has not touched, keep
 * the ones being edited.
 */
export function rebaseDraft<T extends Record<string, string>>(draft: T, oldBase: T, newBase: T): T {
  const next = { ...draft };
  for (const key of Object.keys(newBase) as Array<keyof T>) {
    if (draft[key] === oldBase[key]) next[key] = newBase[key];
  }
  return next;
}
