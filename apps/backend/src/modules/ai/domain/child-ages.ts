/** A list of ages: "4", "1, 4, 7", "5 và 7", "1, 4 and 7", "3/5". */
const AGE_LIST = '((?:\\d{1,2}\\s*(?:,|và|va|and|&|/|-|–)\\s*)*\\d{1,2})';
/** A number that is really a count, a stay length or a time ("10 người lớn", "2 đêm", "11h"). */
const NOT_AN_AGE =
  '(?![\\d\\s]*(?:người|nguoi|ng\\b|nl\\b|khách|khach|adults?|pax|guests?|people|đêm|dem\\b|ngày|ngay|nights?|days?|giờ|gio\\b|h\\b|phòng|phong|pn\\b|rooms?|triệu|tr\\b|k\\b|đ(?![\\p{L}])|vnd))';
/** "4 tuổi", "8 years", "4-year-old", "4yo", "bé 4t". */
const AGE_AFTER = new RegExp(
  `${AGE_LIST}[\\s-]*(tuổi|tuoi|years?|yrs?|yo|y/o|t)(?![\\p{L}])`,
  'gu',
);
/** "aged 1, 4 and 7", "ages 3, 5", "tuổi lần lượt 1, 4, 7", "bé lên 3". */
const AGE_BEFORE = new RegExp(
  `(?<![\\p{L}])(?:aged|ages?|tuổi(?:\\s+(?:lần lượt|là|các bé|các cháu))?|tuoi(?:\\s+(?:lan luot|la))?|(?:bé|be|con|cháu|chau|đứa|dua)\\s+(?:nhà (?:anh|chị|em)\\s+)?lên)\\s*(?::|=|là|la|of)?\\s*${AGE_LIST}${NOT_AN_AGE}`,
  'gu',
);
const MONTHS = new RegExp(`${AGE_LIST}\\s*(tháng|thang|months?)(?![\\p{L}])`, 'gu');

/**
 * The child ages the customer never wrote: an age counts only next to an age word, after it
 * ("4 tuổi", "bé 4, 6 và 9 tuổi", "8 years", "4-year-old", "18 tháng" = 1, "sơ sinh" = 0) or before
 * it ("kids aged 1, 4 and 7", "tuổi lần lượt 1, 4, 7", "bé lên 3"), never a bare number such as the
 * 8 of "8/1/2027" (VL-B3: the model passed [8,8,8,8] for "4 bé"). Returns the unvouched ages.
 */
export function unvouchedChildAges(ages: readonly number[], customerTexts: readonly string[]) {
  const text = customerTexts.join('\n').toLowerCase();
  const said = new Set<number>();
  const numbers = (list: string | undefined) => (list ?? '').match(/\d+/g) ?? [];
  for (const m of text.matchAll(AGE_AFTER)) for (const n of numbers(m[1])) said.add(Number(n));
  for (const m of text.matchAll(AGE_BEFORE)) for (const n of numbers(m[1])) said.add(Number(n));
  for (const m of text.matchAll(MONTHS))
    for (const n of numbers(m[1])) said.add(Math.floor(Number(n) / 12));
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
  const counts = [
    /(\d{1,3})\s*(người|nguoi|ng|khách|khach|nl|adults?|pax|guests?|people|persons?)(?![\p{L}])/gu,
    // VL3-5: a split of the group: "16 in D33", "24 ở E64", "16 cho căn D33".
    /(?<![\d/.:])(\d{1,3})\s+(?:in|at|for|ở|o|tại|tai|cho|bên|ben)\s+(?:căn\s+|can\s+|villa\s+)?[a-z]{0,6}\d{0,3}(?![\p{L}\d])/gu,
    // "nhóm 12", "đoàn 30", "group of 12", "party of 8".
    /(?:nhóm|nhom|đoàn|doan|group of|party of|team of)\s+(\d{1,3})(?![\d/.:])/gu,
  ];
  for (const re of counts) for (const m of text.matchAll(re)) said.add(Number(m[1]));
  // "thêm 4 người": the earlier count plus the new guests.
  const added = [...text.matchAll(/(?:thêm|them|more|extra)\s+(\d{1,3})/gu)].map((m) =>
    Number(m[1]),
  );
  for (const base of [...said]) for (const n of added) said.add(base + n);
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
