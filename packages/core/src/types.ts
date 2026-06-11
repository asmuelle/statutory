/**
 * Domain types for the Statutory pipeline. All shapes are deeply readonly:
 * pipeline stages return new objects and never mutate inputs (AGENTS.md).
 */

/** Jurisdiction identifiers. M1 covers federal; states arrive incrementally. */
export type Jurisdiction = 'us-federal' | 'us-ca' | 'us-ny' | 'us-fl';

/** Practice areas a profile subscribes to (taxonomy dimension 2). */
export type PracticeArea = 'employment' | 'tax' | 'real-estate';

/** Topic identifiers in the M1 taxonomy (federal employment law). */
export type TopicId = 'exempt-status' | 'overtime' | 'hours-worked';

/** A section parsed from a primary source document (post-parser, pre-normalization). */
export interface ParsedSection {
  readonly citation: string;
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly sourceUrl: string;
}

/** Append-only snapshot of a section's text at a retrieval time (invariant 7). */
export interface SectionVersion {
  readonly id: string;
  readonly sectionId: string;
  readonly citation: string;
  readonly normalizedParagraphs: readonly string[];
  readonly normalizedText: string;
  readonly contentHash: string;
  readonly retrievedAt: string;
  readonly sourceUrl: string;
  readonly supersedesVersionId: string | null;
}

/** A canonical section tracked across versions. */
export interface CanonicalSection {
  readonly id: string;
  readonly citation: string;
  readonly heading: string;
  readonly jurisdiction: Jurisdiction;
  readonly currentVersionId: string;
  readonly currentHash: string;
}

/** Paragraph-level structural diff between two section versions. */
export interface StructuralDiff {
  readonly removedParagraphs: readonly string[];
  readonly addedParagraphs: readonly string[];
}

export type ChangeEventStatus =
  | 'detected'
  | 'triaged'
  | 'synthesized'
  | 'verified'
  | 'in_review'
  | 'published'
  | 'rejected'
  | 'archived'
  | 'dead_letter';

/** Emitted only when a section's content hash changes (invariant 1). */
export interface ChangeEvent {
  readonly id: string;
  readonly sectionId: string;
  readonly citation: string;
  readonly oldVersionId: string;
  readonly newVersionId: string;
  readonly detectedAt: string;
  readonly diff: StructuralDiff;
  readonly status: ChangeEventStatus;
}

/** A quoted span pinned to an exact section version (invariant 2). */
export interface Citation {
  readonly citation: string;
  readonly sectionVersionId: string;
  readonly quoteSpan: string;
  readonly verifiedAt: string | null;
}

export type VerificationStatus = 'pending' | 'verified' | 'blocked';

/** One delta per jurisdiction-topic change, fanned out to subscribers (invariant 5). */
export interface Delta {
  readonly id: string;
  readonly jurisdiction: Jurisdiction;
  readonly topic: TopicId;
  readonly changeEventIds: readonly string[];
  readonly title: string;
  readonly bodyMd: string;
  readonly effectiveDate: string;
  readonly citations: readonly Citation[];
  readonly verificationStatus: VerificationStatus;
  readonly publishedAt: string | null;
}

/** Practice profile: who is subscribed to which jurisdiction x practice area. */
export interface PracticeProfile {
  readonly id: string;
  readonly name: string;
  readonly jurisdictions: readonly Jurisdiction[];
  readonly practiceAreas: readonly PracticeArea[];
  readonly clientTypes: readonly string[];
}

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'needs_edit';

/** Attorney review record; publication requires `approved` (invariant 4). */
export interface ReviewRecord {
  readonly id: string;
  readonly deltaId: string;
  readonly reviewerId: string;
  readonly status: ReviewStatus;
  readonly notes: string;
  readonly decidedAt: string | null;
}

/** A delivery of a published delta to one profile over one channel. */
export interface Delivery {
  readonly id: string;
  readonly deltaId: string;
  readonly profileId: string;
  readonly channel: 'web' | 'email';
  readonly sentAt: string;
}

/** Explicit statement of what is — and is not — monitored (invariant 8). */
export interface CoverageManifest {
  readonly jurisdictions: readonly Jurisdiction[];
  readonly topics: readonly TopicId[];
  readonly sources: readonly string[];
  readonly notMonitored: readonly string[];
}
