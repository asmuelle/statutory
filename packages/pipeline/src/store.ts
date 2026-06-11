import type {
  CanonicalSection,
  ChangeEvent,
  ChangeEventStatus,
  Citation,
  Delivery,
  Delta,
  Jurisdiction,
  ReviewRecord,
  ReviewStatus,
  SectionVersion,
  StructuralDiff,
  TopicId,
  VerificationStatus,
} from '@statutory/core';

/**
 * In-memory repository for the M1 slice. Mirrors the Drizzle schema in
 * `@statutory/db` and enforces the storage-layer invariants:
 *  - section versions are append-only and frozen (invariant 7);
 *  - publication requires verified citations AND an approved review — the
 *    store itself refuses anything else (invariant 4), so no pipeline code
 *    path can bypass the gate.
 */

export class PublicationBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicationBlockedError';
  }
}

export interface SeedSectionInput {
  readonly citation: string;
  readonly heading: string;
  readonly jurisdiction: Jurisdiction;
  readonly normalizedParagraphs: readonly string[];
  readonly normalizedText: string;
  readonly contentHash: string;
  readonly retrievedAt: string;
  readonly sourceUrl: string;
}

export interface AppendVersionInput {
  readonly sectionId: string;
  readonly normalizedParagraphs: readonly string[];
  readonly normalizedText: string;
  readonly contentHash: string;
  readonly retrievedAt: string;
  readonly sourceUrl: string;
}

export interface CreateDeltaInput {
  readonly jurisdiction: Jurisdiction;
  readonly topic: TopicId;
  readonly changeEventIds: readonly string[];
  readonly title: string;
  readonly bodyMd: string;
  readonly effectiveDate: string;
  readonly citations: readonly Citation[];
}

export interface MemoryStore {
  getSectionByCitation(citation: string): CanonicalSection | undefined;
  getSection(sectionId: string): CanonicalSection | undefined;
  getVersion(versionId: string): SectionVersion | undefined;
  listVersionsForSection(sectionId: string): readonly SectionVersion[];
  listSections(): readonly CanonicalSection[];
  seedSection(input: SeedSectionInput): CanonicalSection;
  appendVersion(input: AppendVersionInput): SectionVersion;
  createChangeEvent(input: {
    readonly sectionId: string;
    readonly citation: string;
    readonly oldVersionId: string;
    readonly newVersionId: string;
    readonly detectedAt: string;
    readonly diff: StructuralDiff;
  }): ChangeEvent;
  updateChangeEventStatus(eventId: string, status: ChangeEventStatus): ChangeEvent;
  getChangeEvent(eventId: string): ChangeEvent | undefined;
  listChangeEvents(): readonly ChangeEvent[];
  createDelta(input: CreateDeltaInput): Delta;
  getDelta(deltaId: string): Delta | undefined;
  setDeltaVerification(
    deltaId: string,
    status: VerificationStatus,
    citations: readonly Citation[],
  ): Delta;
  recordReview(input: {
    readonly deltaId: string;
    readonly reviewerId: string;
    readonly status: ReviewStatus;
    readonly notes: string;
    readonly decidedAt: string | null;
  }): ReviewRecord;
  reviewTrail(deltaId: string): readonly ReviewRecord[];
  latestReview(deltaId: string): ReviewRecord | undefined;
  publishDelta(deltaId: string, publishedAt: string): Delta;
  addDelivery(input: {
    readonly deltaId: string;
    readonly profileId: string;
    readonly channel: Delivery['channel'];
    readonly sentAt: string;
  }): Delivery;
  listDeliveries(): readonly Delivery[];
}

export const createMemoryStore = (): MemoryStore => {
  const sections = new Map<string, CanonicalSection>();
  const sectionsByCitation = new Map<string, string>();
  const versions = new Map<string, SectionVersion>();
  const versionOrder: string[] = [];
  const changeEvents = new Map<string, ChangeEvent>();
  const deltas = new Map<string, Delta>();
  const reviews: ReviewRecord[] = [];
  const deliveries: Delivery[] = [];
  const counters = { sec: 0, ver: 0, evt: 0, delta: 0, rev: 0, dlv: 0 };

  const nextId = (kind: keyof typeof counters): string => {
    counters[kind] += 1;
    return `${kind}-${counters[kind]}`;
  };

  const putVersion = (version: SectionVersion): SectionVersion => {
    const frozen = Object.freeze(version);
    versions.set(frozen.id, frozen);
    versionOrder.push(frozen.id);
    return frozen;
  };

  const requireDelta = (deltaId: string): Delta => {
    const delta = deltas.get(deltaId);
    if (delta === undefined) {
      throw new Error(`Unknown delta: ${deltaId}`);
    }
    return delta;
  };

  return {
    getSectionByCitation: (citation) => {
      const id = sectionsByCitation.get(citation);
      return id === undefined ? undefined : sections.get(id);
    },
    getSection: (sectionId) => sections.get(sectionId),
    getVersion: (versionId) => versions.get(versionId),
    listVersionsForSection: (sectionId) =>
      versionOrder
        .map((id) => versions.get(id))
        .filter((v): v is SectionVersion => v !== undefined && v.sectionId === sectionId),
    listSections: () => [...sections.values()],

    seedSection: (input) => {
      if (sectionsByCitation.has(input.citation)) {
        throw new Error(`Section already exists: ${input.citation}`);
      }
      const sectionId = nextId('sec');
      const version = putVersion({
        id: nextId('ver'),
        sectionId,
        citation: input.citation,
        normalizedParagraphs: input.normalizedParagraphs,
        normalizedText: input.normalizedText,
        contentHash: input.contentHash,
        retrievedAt: input.retrievedAt,
        sourceUrl: input.sourceUrl,
        supersedesVersionId: null,
      });
      const section = Object.freeze({
        id: sectionId,
        citation: input.citation,
        heading: input.heading,
        jurisdiction: input.jurisdiction,
        currentVersionId: version.id,
        currentHash: input.contentHash,
      });
      sections.set(sectionId, section);
      sectionsByCitation.set(input.citation, sectionId);
      return section;
    },

    appendVersion: (input) => {
      const section = sections.get(input.sectionId);
      if (section === undefined) {
        throw new Error(`Unknown section: ${input.sectionId}`);
      }
      const version = putVersion({
        id: nextId('ver'),
        sectionId: section.id,
        citation: section.citation,
        normalizedParagraphs: input.normalizedParagraphs,
        normalizedText: input.normalizedText,
        contentHash: input.contentHash,
        retrievedAt: input.retrievedAt,
        sourceUrl: input.sourceUrl,
        supersedesVersionId: section.currentVersionId,
      });
      sections.set(
        section.id,
        Object.freeze({
          ...section,
          currentVersionId: version.id,
          currentHash: input.contentHash,
        }),
      );
      return version;
    },

    createChangeEvent: (input) => {
      const event: ChangeEvent = Object.freeze({
        id: nextId('evt'),
        status: 'detected' as const,
        ...input,
      });
      changeEvents.set(event.id, event);
      return event;
    },
    updateChangeEventStatus: (eventId, status) => {
      const event = changeEvents.get(eventId);
      if (event === undefined) {
        throw new Error(`Unknown change event: ${eventId}`);
      }
      const updated = Object.freeze({ ...event, status });
      changeEvents.set(eventId, updated);
      return updated;
    },
    getChangeEvent: (eventId) => changeEvents.get(eventId),
    listChangeEvents: () => [...changeEvents.values()],

    createDelta: (input) => {
      const delta: Delta = Object.freeze({
        id: nextId('delta'),
        verificationStatus: 'pending' as const,
        publishedAt: null,
        ...input,
      });
      deltas.set(delta.id, delta);
      return delta;
    },
    getDelta: (deltaId) => deltas.get(deltaId),
    setDeltaVerification: (deltaId, status, citations) => {
      const delta = requireDelta(deltaId);
      const updated = Object.freeze({ ...delta, verificationStatus: status, citations });
      deltas.set(deltaId, updated);
      return updated;
    },

    recordReview: (input) => {
      const record: ReviewRecord = Object.freeze({ id: nextId('rev'), ...input });
      reviews.push(record);
      return record;
    },
    reviewTrail: (deltaId) => reviews.filter((r) => r.deltaId === deltaId),
    latestReview: (deltaId) => reviews.filter((r) => r.deltaId === deltaId).at(-1),

    publishDelta: (deltaId, publishedAt) => {
      const delta = requireDelta(deltaId);
      if (delta.verificationStatus !== 'verified') {
        throw new PublicationBlockedError(
          `Delta ${deltaId} is '${delta.verificationStatus}', not 'verified' — the gate has not passed.`,
        );
      }
      if (delta.citations.some((c) => c.verifiedAt === null)) {
        throw new PublicationBlockedError(
          `Delta ${deltaId} carries citations without verifiedAt stamps.`,
        );
      }
      const review = reviews.filter((r) => r.deltaId === deltaId).at(-1);
      if (review === undefined || review.status !== 'approved') {
        throw new PublicationBlockedError(
          `Delta ${deltaId} has no approved review record (latest: ${review?.status ?? 'none'}).`,
        );
      }
      const published = Object.freeze({ ...delta, publishedAt });
      deltas.set(deltaId, published);
      return published;
    },

    addDelivery: (input) => {
      const delta = requireDelta(input.deltaId);
      if (delta.publishedAt === null) {
        throw new PublicationBlockedError(
          `Cannot deliver unpublished delta ${input.deltaId} to ${input.profileId}.`,
        );
      }
      const delivery: Delivery = Object.freeze({ id: nextId('dlv'), ...input });
      deliveries.push(delivery);
      return delivery;
    },
    listDeliveries: () => [...deliveries],
  };
};
