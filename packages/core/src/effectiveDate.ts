/**
 * Effective-date extraction and cross-checking (invariant 3): the model's
 * claimed effective date must agree with a deterministic regex extraction
 * from the primary source text, or publication is blocked.
 */

const MONTHS: Readonly<Record<string, string>> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

const PROSE_DATE =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/g;
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const EFFECTIVE_PROSE =
  /\beffective\s+(?:on\s+|date\s+of\s+|beginning\s+(?:on\s+)?)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/gi;
// Live Federal Register DATES prose (e.g. 89 FR 32842): "The effective date
// for this final rule is July 1, 2024." Bounded within one sentence.
const EFFECTIVE_DATE_IS =
  /\beffective\s+date\b[^.!?]{0,80}?\bis\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/gi;

const toIso = (monthName: string, day: string, year: string): string => {
  const month = MONTHS[monthName.toLowerCase()];
  if (month === undefined) {
    throw new Error(`Unknown month name: ${monthName}`);
  }
  return `${year}-${month}-${day.padStart(2, '0')}`;
};

const dedupeSorted = (dates: readonly string[]): readonly string[] => [...new Set(dates)].sort();

/** All dates mentioned in a text, as sorted unique ISO strings. */
export const extractAllDates = (text: string): readonly string[] => {
  const prose = [...text.matchAll(PROSE_DATE)].map((m) =>
    toIso(m[1] ?? '', m[2] ?? '', m[3] ?? ''),
  );
  const iso = [...text.matchAll(ISO_DATE)].map((m) => `${m[1]}-${m[2]}-${m[3]}`);
  return dedupeSorted([...prose, ...iso]);
};

/** Dates that appear in an explicit "effective ..." construction. */
export const extractEffectiveDates = (text: string): readonly string[] =>
  dedupeSorted(
    [...text.matchAll(EFFECTIVE_PROSE), ...text.matchAll(EFFECTIVE_DATE_IS)].map((m) =>
      toIso(m[1] ?? '', m[2] ?? '', m[3] ?? ''),
    ),
  );

export interface EffectiveDateCheck {
  readonly agrees: boolean;
  readonly modelDate: string;
  readonly sourceDates: readonly string[];
}

/**
 * Cross-check a model-claimed effective date against deterministic extraction
 * from source text. Disagreement must block publication (invariant 3).
 */
export const crossCheckEffectiveDate = (
  modelDate: string,
  sourceText: string,
): EffectiveDateCheck => {
  const sourceDates = extractEffectiveDates(sourceText);
  return {
    agrees: sourceDates.includes(modelDate),
    modelDate,
    sourceDates,
  };
};
