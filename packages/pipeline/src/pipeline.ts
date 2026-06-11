import {
  canonicalSectionText,
  computeStructuralDiff,
  hashText,
  matchProfiles,
  normalizeParagraphs,
  runVerificationGate,
} from '@statutory/core';
import type {
  ChangeEvent,
  Delivery,
  Delta,
  GateResult,
  Jurisdiction,
  ParsedSection,
  PracticeProfile,
  TopicId,
} from '@statutory/core';

import type { SynthesisModel, TriageModel, TriageResult } from './llm/types.js';
import type { FederalRegisterDoc } from './sources/federalRegister.js';
import type { MemoryStore } from './store.js';

/**
 * Pipeline stages: crawl -> diff -> triage -> synthesize -> verify -> review
 * -> publish -> fan out. Everything before triage is pure deterministic code;
 * models never see unchanged sections (invariants 1, 6).
 */

export interface CrawlReport {
  readonly seeded: number;
  readonly unchanged: number;
  readonly changeEvents: readonly ChangeEvent[];
}

/** Ingest parsed sections: seed new ones, diff known ones, emit change events. */
export const crawlSections = (
  store: MemoryStore,
  parsedSections: readonly ParsedSection[],
  options: { readonly jurisdiction: Jurisdiction; readonly retrievedAt: string },
): CrawlReport => {
  let seeded = 0;
  let unchanged = 0;
  const changeEvents: ChangeEvent[] = [];

  for (const parsed of parsedSections) {
    const paragraphs = normalizeParagraphs(parsed.paragraphs);
    const text = canonicalSectionText(parsed.paragraphs);
    const hash = hashText(text);
    const existing = store.getSectionByCitation(parsed.citation);

    if (existing === undefined) {
      store.seedSection({
        citation: parsed.citation,
        heading: parsed.heading,
        jurisdiction: options.jurisdiction,
        normalizedParagraphs: paragraphs,
        normalizedText: text,
        contentHash: hash,
        retrievedAt: options.retrievedAt,
        sourceUrl: parsed.sourceUrl,
      });
      seeded += 1;
      continue;
    }

    if (existing.currentHash === hash) {
      unchanged += 1;
      continue;
    }

    const oldVersion = store.getVersion(existing.currentVersionId);
    if (oldVersion === undefined) {
      throw new Error(`Section ${existing.citation} points at missing version — store corrupt.`);
    }
    const newVersion = store.appendVersion({
      sectionId: existing.id,
      normalizedParagraphs: paragraphs,
      normalizedText: text,
      contentHash: hash,
      retrievedAt: options.retrievedAt,
      sourceUrl: parsed.sourceUrl,
    });
    changeEvents.push(
      store.createChangeEvent({
        sectionId: existing.id,
        citation: existing.citation,
        oldVersionId: oldVersion.id,
        newVersionId: newVersion.id,
        detectedAt: options.retrievedAt,
        diff: computeStructuralDiff(oldVersion.normalizedParagraphs, paragraphs),
      }),
    );
  }

  return { seeded, unchanged, changeEvents };
};

export interface TriageOutcome extends TriageResult {
  readonly routed: boolean;
}

/** Triage detected changes against profiles; unrouted events are archived. */
export const triageChangeEvents = async (
  store: MemoryStore,
  events: readonly ChangeEvent[],
  model: TriageModel,
  jurisdiction: Jurisdiction,
  profiles: readonly PracticeProfile[],
): Promise<readonly TriageOutcome[]> => {
  const outcomes: TriageOutcome[] = [];
  for (const event of events) {
    const result = await model.triage({ changeEvent: event, jurisdiction, profiles });
    const routed = result.topicId !== null && result.matchedProfileIds.length > 0;
    store.updateChangeEventStatus(event.id, routed ? 'triaged' : 'archived');
    outcomes.push({ ...result, routed });
  }
  return outcomes;
};

export interface SynthesisOutcome {
  readonly deltaId: string;
  readonly jurisdiction: Jurisdiction;
  readonly topicId: TopicId;
}

/** Author exactly ONE delta per jurisdiction-topic group (invariant 5). */
export const synthesizeDeltas = async (
  store: MemoryStore,
  outcomes: readonly TriageOutcome[],
  model: SynthesisModel,
  frDoc: FederalRegisterDoc,
): Promise<readonly SynthesisOutcome[]> => {
  const routed = outcomes.filter((o) => o.routed && o.topicId !== null);
  const groups = new Map<string, TriageOutcome[]>();
  for (const outcome of routed) {
    const key = `${outcome.jurisdiction}:${outcome.topicId}`;
    groups.set(key, [...(groups.get(key) ?? []), outcome]);
  }

  const results: SynthesisOutcome[] = [];
  for (const grouped of groups.values()) {
    const first = grouped[0];
    if (first === undefined || first.topicId === null) {
      continue;
    }
    const events = grouped
      .map((o) => store.getChangeEvent(o.changeEventId))
      .filter((e): e is ChangeEvent => e !== undefined);
    const newVersions = events
      .map((e) => store.getVersion(e.newVersionId))
      .filter((v): v is NonNullable<typeof v> => v !== undefined);

    const draft = await model.synthesize({
      jurisdiction: first.jurisdiction,
      topicId: first.topicId,
      changeEvents: events,
      newVersions,
      frDoc,
    });
    const delta = store.createDelta({
      jurisdiction: first.jurisdiction,
      topic: first.topicId,
      changeEventIds: events.map((e) => e.id),
      title: draft.title,
      bodyMd: draft.bodyMd,
      effectiveDate: draft.effectiveDate,
      citations: draft.citations.map((c) => ({ ...c, verifiedAt: null })),
    });
    for (const event of events) {
      store.updateChangeEventStatus(event.id, 'synthesized');
    }
    results.push({ deltaId: delta.id, jurisdiction: first.jurisdiction, topicId: first.topicId });
  }
  return results;
};

/** Run the deterministic verification gate; failures route to review as needs_edit. */
export const verifyDelta = (
  store: MemoryStore,
  deltaId: string,
  frDoc: FederalRegisterDoc,
  now: string,
): GateResult => {
  const delta = store.getDelta(deltaId);
  if (delta === undefined) {
    throw new Error(`Unknown delta: ${deltaId}`);
  }
  const result = runVerificationGate({
    citations: delta.citations,
    modelEffectiveDate: delta.effectiveDate,
    sourceDateText: frDoc.body_excerpt,
    getVersion: (id) => store.getVersion(id),
    now,
  });

  store.setDeltaVerification(deltaId, result.ok ? 'verified' : 'blocked', result.verifiedCitations);
  store.recordReview({
    deltaId,
    reviewerId: 'system-gate',
    status: result.ok ? 'pending' : 'needs_edit',
    notes: result.ok
      ? 'Gate passed: all spans string-matched; effective date cross-checked.'
      : `Gate BLOCKED: ${result.failures.map((f) => `${f.kind}: ${f.detail}`).join(' | ')}`,
    decidedAt: null,
  });
  for (const eventId of delta.changeEventIds) {
    store.updateChangeEventStatus(eventId, result.ok ? 'verified' : 'in_review');
  }
  return result;
};

/** Record a human review decision (approve / reject / needs_edit). */
export const reviewDelta = (
  store: MemoryStore,
  input: {
    readonly deltaId: string;
    readonly reviewerId: string;
    readonly status: 'approved' | 'rejected' | 'needs_edit';
    readonly notes: string;
    readonly decidedAt: string;
  },
): void => {
  store.recordReview(input);
  if (input.status === 'rejected') {
    const delta = store.getDelta(input.deltaId);
    for (const eventId of delta?.changeEventIds ?? []) {
      store.updateChangeEventStatus(eventId, 'rejected');
    }
  }
};

export interface PublishOutcome {
  readonly delta: Delta;
  readonly matchedProfiles: readonly PracticeProfile[];
  readonly deliveries: readonly Delivery[];
}

/** Publish (store enforces the gate + review) and fan out to matching profiles. */
export const publishAndFanOut = (
  store: MemoryStore,
  deltaId: string,
  profiles: readonly PracticeProfile[],
  publishedAt: string,
): PublishOutcome => {
  const published = store.publishDelta(deltaId, publishedAt);
  const matchedProfiles = matchProfiles(published.jurisdiction, published.topic, profiles);
  const deliveries = matchedProfiles.flatMap((profile) =>
    (['web', 'email'] as const).map((channel) =>
      store.addDelivery({ deltaId, profileId: profile.id, channel, sentAt: publishedAt }),
    ),
  );
  for (const eventId of published.changeEventIds) {
    store.updateChangeEventStatus(eventId, 'published');
  }
  return { delta: published, matchedProfiles, deliveries };
};
