import { matchProfiles } from './profileMatch.js';
import { topicForCitation } from './taxonomy.js';
import type {
  CanonicalSection,
  Delta,
  Jurisdiction,
  PracticeArea,
  PracticeProfile,
} from './types.js';

/**
 * Practice-profile onboarding (M3): wizard selections map onto the SAME
 * PracticeProfile shape the pipeline fans out to — onboarding feeds the
 * existing profile-matching machinery, it does not grow a parallel one.
 * Completing onboarding scopes the rulebook and the delta feed to the
 * profile via deterministic taxonomy lookups (invariant 6).
 */

export interface WizardOption<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
}

export const JURISDICTION_OPTIONS: readonly WizardOption<Jurisdiction>[] = [
  { id: 'us-federal', label: 'Federal (US)' },
  { id: 'us-ca', label: 'California' },
  { id: 'us-ny', label: 'New York' },
  { id: 'us-fl', label: 'Florida' },
];

export const PRACTICE_AREA_OPTIONS: readonly WizardOption<PracticeArea>[] = [
  { id: 'employment', label: 'Employment law' },
  { id: 'tax', label: 'Tax' },
  { id: 'real-estate', label: 'Real estate' },
];

export const CLIENT_TYPE_OPTIONS: readonly WizardOption[] = [
  { id: 'small-business', label: 'Small businesses' },
  { id: 'startups', label: 'Startups' },
  { id: 'mid-market', label: 'Mid-market employers' },
  { id: 's-corps', label: 'S-corps & owner-operators' },
  { id: 'individuals', label: 'Individuals' },
  { id: 'nonprofits', label: 'Nonprofits' },
];

export interface WizardSelection {
  readonly jurisdictions: readonly Jurisdiction[];
  readonly practiceAreas: readonly PracticeArea[];
  readonly clientTypes: readonly string[];
}

export interface BuildProfileInput {
  readonly id: string;
  readonly name: string;
  readonly selection: WizardSelection;
}

const dedupe = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

/** Map validated wizard selections onto the pipeline's PracticeProfile. */
export const buildPracticeProfile = (input: BuildProfileInput): PracticeProfile => ({
  id: input.id,
  name: input.name,
  jurisdictions: dedupe(input.selection.jurisdictions),
  practiceAreas: dedupe(input.selection.practiceAreas),
  clientTypes: dedupe(input.selection.clientTypes),
});

export interface ScopedRulebook {
  readonly sections: readonly CanonicalSection[];
  readonly deltas: readonly Delta[];
}

/**
 * Scope the rulebook and delta feed to one profile:
 *  - sections stay only when their jurisdiction is subscribed AND their
 *    citation maps (deterministically) to a topic in a subscribed practice
 *    area; citations outside the taxonomy are excluded, never guessed at;
 *  - the delta feed contains only PUBLISHED deltas routed through the
 *    existing matchProfiles fan-out logic (invariant 4: unpublished content
 *    never reaches a user surface).
 */
export const scopeRulebook = (
  profile: PracticeProfile,
  sections: readonly CanonicalSection[],
  deltas: readonly Delta[],
): ScopedRulebook => {
  const scopedSections = sections.filter((s) => {
    if (!profile.jurisdictions.includes(s.jurisdiction)) {
      return false;
    }
    const topic = topicForCitation(s.citation);
    return topic !== undefined && profile.practiceAreas.includes(topic.practiceArea);
  });

  const scopedDeltas = deltas.filter(
    (d) =>
      d.publishedAt !== null && matchProfiles(d.jurisdiction, d.topic, [profile]).length === 1,
  );

  return { sections: scopedSections, deltas: scopedDeltas };
};
