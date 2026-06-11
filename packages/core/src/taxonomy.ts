import type { PracticeArea, TopicId } from './types.js';

/**
 * Jurisdiction x topic taxonomy for the M1 slice: federal employment law,
 * eCFR Title 29 Parts 541 (exempt status), 778 (overtime), 785 (hours worked).
 * Deterministic mapping used by triage; the cheap model only confirms it.
 */

export interface TopicDefinition {
  readonly id: TopicId;
  readonly label: string;
  readonly practiceArea: PracticeArea;
  readonly cfrTitle: number;
  readonly cfrParts: readonly number[];
}

export const TOPICS: readonly TopicDefinition[] = [
  {
    id: 'exempt-status',
    label: 'Exempt status & salary thresholds',
    practiceArea: 'employment',
    cfrTitle: 29,
    cfrParts: [541],
  },
  {
    id: 'overtime',
    label: 'Overtime compensation',
    practiceArea: 'employment',
    cfrTitle: 29,
    cfrParts: [778],
  },
  {
    id: 'hours-worked',
    label: 'Hours worked',
    practiceArea: 'employment',
    cfrTitle: 29,
    cfrParts: [785],
  },
];

const CFR_CITATION = /^(\d+)\s+CFR\s+§\s+(\d+)\.\d+/;

/** Parse "29 CFR § 541.600" into title/part numbers. */
export const parseCfrCitation = (
  citation: string,
): { readonly title: number; readonly part: number } | undefined => {
  const match = CFR_CITATION.exec(citation);
  if (match === null) {
    return undefined;
  }
  return { title: Number(match[1]), part: Number(match[2]) };
};

/** Deterministically map a CFR citation to its taxonomy topic. */
export const topicForCitation = (citation: string): TopicDefinition | undefined => {
  const parsed = parseCfrCitation(citation);
  if (parsed === undefined) {
    return undefined;
  }
  return TOPICS.find((t) => t.cfrTitle === parsed.title && t.cfrParts.includes(parsed.part));
};

/** Look up a topic definition by id. */
export const topicById = (id: TopicId): TopicDefinition => {
  const topic = TOPICS.find((t) => t.id === id);
  if (topic === undefined) {
    throw new Error(`Unknown topic id: ${id}`);
  }
  return topic;
};
