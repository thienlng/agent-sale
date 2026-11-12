/**
 * The child ages the customer never wrote: an age counts only next to an age word ("4 tuổi",
 * "bé 4, 6 và 9 tuổi", "8 years", "18 tháng" = 1, "sơ sinh" = 0), never a bare number such as the
 * 8 of "8/1/2027" (VL-B3: the model passed [8,8,8,8] for "4 bé"). Returns the unvouched ages.
 */
export function unvouchedChildAges(ages: readonly number[], customerTexts: readonly string[]) {
  const text = customerTexts.join('\n').toLowerCase();
  const said = new Set<number>();
  const LIST = '((?:\\d{1,2}\\s*(?:,|và|va|&|/|-|–)\\s*)*\\d{1,2})\\s*';
  for (const m of text.matchAll(new RegExp(`${LIST}(tuổi|tuoi|years?|yo|y/o|t)(?![\\p{L}])`, 'gu')))
    for (const n of (m[1] ?? '').match(/\d+/g) ?? []) said.add(Number(n));
  for (const m of text.matchAll(new RegExp(`${LIST}(tháng|thang|months?)(?![\\p{L}])`, 'gu')))
    for (const n of (m[1] ?? '').match(/\d+/g) ?? []) said.add(Math.floor(Number(n) / 12));
  if (/sơ sinh|so sinh|newborn/.test(text)) said.add(0);
  return ages.filter((age) => !said.has(age));
}

/**
 * The adult count is the customer's: a number next to a party word ("20 người lớn", "6 người",
 * "15 khách", "10 adults", "9 NL"). A count never written is the model's guess (the bot quoted a
 * free weekend for an invented party). Zero adults is left to the lodging module's own check.
 */
export function adultsVouched(adults: number, customerTexts: readonly string[]): boolean {
  if (adults <= 0) return true;
  const text = customerTexts.join('\n').toLowerCase();
  const said = new Set<number>();
  for (const m of text.matchAll(
    /(\d{1,3})\s*(người|nguoi|ng|khách|khach|nl|adults?|pax|guests?|people|persons?)(?![\p{L}])/gu,
  ))
    said.add(Number(m[1]));
  return said.has(adults);
}

/** The problem code of a party the customer did not write (VL-B3), or null. */
export function partyNotGiven(
  party: { adults: number; childAges?: readonly number[] | undefined },
  customerTexts: readonly string[],
): 'party_not_given' | 'child_ages_not_given' | null {
  if (!adultsVouched(party.adults, customerTexts)) return 'party_not_given';
  return unvouchedChildAges(party.childAges ?? [], customerTexts).length
    ? 'child_ages_not_given'
    : null;
}
