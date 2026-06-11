import { describe, expect, test } from 'vitest';

import type { PracticeProfile } from '@statutory/core';

import { defaultFixturesDir, readFixture } from './fixtures.js';
import {
  createMockSynthesisModel,
  createMockTriageModel,
  withEffectiveDateOverride,
  withQuoteCorruption,
} from './llm/mockModels.js';
import {
  crawlSections,
  publishAndFanOut,
  reviewDelta,
  synthesizeDeltas,
  triageChangeEvents,
  verifyDelta,
} from './pipeline.js';
import { parseEcfrXml } from './sources/ecfr.js';
import { parseFederalRegisterDoc } from './sources/federalRegister.js';
import { PublicationBlockedError, createMemoryStore } from './store.js';

const FIXTURES = defaultFixturesDir();
const PARSE_OPTIONS = { cfrTitle: 29, sourceUrl: 'https://www.ecfr.gov/current/title-29' };
const CRAWL = { jurisdiction: 'us-federal' as const, retrievedAt: '2024-07-01T06:00:00Z' };

const PROFILES: readonly PracticeProfile[] = [
  {
    id: 'profile-ca',
    name: 'CA employment lawyer',
    jurisdictions: ['us-federal', 'us-ca'],
    practiceAreas: ['employment'],
    clientTypes: [],
  },
  {
    id: 'profile-ny',
    name: 'NY HR consultant',
    jurisdictions: ['us-federal', 'us-ny'],
    practiceAreas: ['employment'],
    clientTypes: [],
  },
  {
    id: 'profile-fl-tax',
    name: 'FL tax CPA',
    jurisdictions: ['us-federal', 'us-fl'],
    practiceAreas: ['tax'],
    clientTypes: [],
  },
];

const loadSections = (file: string) =>
  parseEcfrXml(readFixture(FIXTURES, `ecfr/${file}`), PARSE_OPTIONS);

const loadFrDoc = () =>
  parseFederalRegisterDoc(readFixture(FIXTURES, 'federal-register/2024-08038.json'));

/** Seed baseline + crawl amendment; returns store and the resulting events. */
const seedAndAmend = () => {
  const store = createMemoryStore();
  crawlSections(store, loadSections('title29-chapterV-2024-04-01.xml'), {
    ...CRAWL,
    retrievedAt: '2024-04-01T06:00:00Z',
  });
  const report = crawlSections(store, loadSections('title29-chapterV-2024-07-01.xml'), CRAWL);
  return { store, report };
};

describe('crawl + diff (invariant 1: deterministic before LLM)', () => {
  test('baseline crawl seeds all sections without change events', () => {
    // Arrange
    const store = createMemoryStore();

    // Act
    const report = crawlSections(store, loadSections('title29-chapterV-2024-04-01.xml'), CRAWL);

    // Assert
    expect(report.seeded).toBe(4);
    expect(report.changeEvents).toHaveLength(0);
  });

  test('re-crawling the identical snapshot yields zero change events', () => {
    // Arrange
    const store = createMemoryStore();
    const sections = loadSections('title29-chapterV-2024-04-01.xml');
    crawlSections(store, sections, CRAWL);

    // Act
    const recrawl = crawlSections(store, sections, { ...CRAWL, retrievedAt: '2024-07-02T06:00:00Z' });

    // Assert
    expect(recrawl.seeded).toBe(0);
    expect(recrawl.unchanged).toBe(4);
    expect(recrawl.changeEvents).toHaveLength(0);
  });

  test('the 2024 amendment produces exactly ONE change event (whitespace churn in §541.602 is ignored)', () => {
    // Act
    const { report } = seedAndAmend();

    // Assert — § 541.602 differs only in whitespace/curly quotes in the fixture
    expect(report.changeEvents).toHaveLength(1);
    expect(report.changeEvents[0]?.citation).toBe('29 CFR § 541.600');
    expect(report.unchanged).toBe(3);
  });

  test('the structural diff captures the salary-threshold amendment', () => {
    // Act
    const { report } = seedAndAmend();
    const diff = report.changeEvents[0]?.diff;

    // Assert
    expect(diff?.removedParagraphs.join(' ')).toContain('$684 per week');
    expect(diff?.addedParagraphs.join(' ')).toContain('$844 per week');
    expect(diff?.addedParagraphs.join(' ')).toContain('$1,128 per week');
  });
});

describe('triage (cheap model only, invariant 6)', () => {
  test('routes the §541.600 change to exempt-status and the employment profiles', async () => {
    // Arrange
    const { store, report } = seedAndAmend();
    const triage = createMockTriageModel();

    // Act
    const outcomes = await triageChangeEvents(store, report.changeEvents, triage, 'us-federal', PROFILES);

    // Assert
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.topicId).toBe('exempt-status');
    expect(outcomes[0]?.matchedProfileIds).toEqual(['profile-ca', 'profile-ny']);
    expect(triage.callCount).toBe(1);
  });

  test('archives events that match no profile', async () => {
    // Arrange
    const { store, report } = seedAndAmend();
    const triage = createMockTriageModel();
    const taxOnly = PROFILES.filter((p) => p.practiceAreas.includes('tax'));

    // Act
    const outcomes = await triageChangeEvents(store, report.changeEvents, triage, 'us-federal', taxOnly);

    // Assert
    expect(outcomes[0]?.routed).toBe(false);
    expect(store.getChangeEvent(report.changeEvents[0]?.id ?? '')?.status).toBe('archived');
  });
});

describe('synthesis (author once, fan out — invariant 5)', () => {
  test('two subscribed profiles still produce exactly ONE synthesis call and ONE delta', async () => {
    // Arrange
    const { store, report } = seedAndAmend();
    const triage = createMockTriageModel();
    const synthesis = createMockSynthesisModel();
    const outcomes = await triageChangeEvents(store, report.changeEvents, triage, 'us-federal', PROFILES);

    // Act
    const synthesized = await synthesizeDeltas(store, outcomes, synthesis, loadFrDoc());

    // Assert
    expect(synthesized).toHaveLength(1);
    expect(synthesis.callCount).toBe(1);
  });

  test('the draft delta pins citations to the NEW section version', async () => {
    // Arrange
    const { store, report } = seedAndAmend();
    const outcomes = await triageChangeEvents(
      store, report.changeEvents, createMockTriageModel(), 'us-federal', PROFILES,
    );

    // Act
    const [synth] = await synthesizeDeltas(store, outcomes, createMockSynthesisModel(), loadFrDoc());
    const delta = store.getDelta(synth?.deltaId ?? '');

    // Assert
    expect(delta?.citations.length).toBeGreaterThan(0);
    expect(delta?.citations.every((c) => c.sectionVersionId === report.changeEvents[0]?.newVersionId)).toBe(true);
    expect(delta?.verificationStatus).toBe('pending');
  });
});

/** Full happy path up to a verified, approved delta. */
const runToVerified = async (synthesisModel = createMockSynthesisModel()) => {
  const { store, report } = seedAndAmend();
  const frDoc = loadFrDoc();
  const outcomes = await triageChangeEvents(
    store, report.changeEvents, createMockTriageModel(), 'us-federal', PROFILES,
  );
  const [synth] = await synthesizeDeltas(store, outcomes, synthesisModel, frDoc);
  if (synth === undefined) {
    throw new Error('no delta synthesized');
  }
  const gate = verifyDelta(store, synth.deltaId, frDoc, '2024-07-01T06:05:00Z');
  return { store, deltaId: synth.deltaId, gate };
};

describe('verification gate wiring (invariants 2 + 3)', () => {
  test('the honest mock passes the gate and citations get verifiedAt stamps', async () => {
    // Act
    const { store, deltaId, gate } = await runToVerified();

    // Assert
    expect(gate.ok).toBe(true);
    const delta = store.getDelta(deltaId);
    expect(delta?.verificationStatus).toBe('verified');
    expect(delta?.citations.every((c) => c.verifiedAt !== null)).toBe(true);
    expect(store.latestReview(deltaId)?.status).toBe('pending');
  });

  test('SEEDED MUTATION: a paraphrasing model ("shall"->"must", $844->$884) is blocked', async () => {
    // Arrange — corrupt quotes the way LLM paraphrase drift does
    const corrupting = withQuoteCorruption(createMockSynthesisModel(), (q) =>
      q.replace('must', 'shall').replace('$844', '$884'),
    );

    // Act
    const { store, deltaId, gate } = await runToVerified(corrupting);

    // Assert
    expect(gate.ok).toBe(false);
    expect(gate.failures.some((f) => f.kind === 'span_mismatch')).toBe(true);
    expect(store.getDelta(deltaId)?.verificationStatus).toBe('blocked');
    expect(store.latestReview(deltaId)?.status).toBe('needs_edit');
  });

  test('SEEDED MUTATION: a skewed effective date is blocked by the cross-check', async () => {
    // Arrange
    const skewed = withEffectiveDateOverride(createMockSynthesisModel(), '2024-08-01');

    // Act
    const { gate } = await runToVerified(skewed);

    // Assert
    expect(gate.ok).toBe(false);
    expect(gate.failures.map((f) => f.kind)).toContain('effective_date_mismatch');
  });

  test('a gate-blocked delta cannot be published through ANY path, even with approval', async () => {
    // Arrange
    const corrupting = withQuoteCorruption(createMockSynthesisModel(), (q) => q.replace('$844', '$884'));
    const { store, deltaId } = await runToVerified(corrupting);
    reviewDelta(store, {
      deltaId,
      reviewerId: 'rogue-reviewer',
      status: 'approved',
      notes: 'Trying to force it through.',
      decidedAt: '2024-07-01T14:00:00Z',
    });

    // Act / Assert
    expect(() => publishAndFanOut(store, deltaId, PROFILES, '2024-07-01T14:31:00Z')).toThrow(
      PublicationBlockedError,
    );
  });
});

describe('review + publish + fan-out (invariant 4)', () => {
  test('publishing without human approval is blocked', async () => {
    // Arrange
    const { store, deltaId } = await runToVerified();

    // Act / Assert — gate passed, but only the system "pending" record exists
    expect(() => publishAndFanOut(store, deltaId, PROFILES, '2024-07-01T14:31:00Z')).toThrow(
      PublicationBlockedError,
    );
  });

  test('a rejected delta stays unpublished and its events are marked rejected', async () => {
    // Arrange
    const { store, deltaId } = await runToVerified();
    reviewDelta(store, {
      deltaId,
      reviewerId: 'attorney-1',
      status: 'rejected',
      notes: 'Not relevant.',
      decidedAt: '2024-07-01T14:00:00Z',
    });

    // Act / Assert
    expect(() => publishAndFanOut(store, deltaId, PROFILES, '2024-07-01T14:31:00Z')).toThrow(
      PublicationBlockedError,
    );
    const delta = store.getDelta(deltaId);
    expect(delta?.changeEventIds.every((id) => store.getChangeEvent(id)?.status === 'rejected')).toBe(true);
  });

  test('approval publishes once and fans out to exactly the matching profiles', async () => {
    // Arrange
    const { store, deltaId } = await runToVerified();
    reviewDelta(store, {
      deltaId,
      reviewerId: 'attorney-1',
      status: 'approved',
      notes: 'Verified.',
      decidedAt: '2024-07-01T14:00:00Z',
    });

    // Act
    const outcome = publishAndFanOut(store, deltaId, PROFILES, '2024-07-01T14:31:00Z');

    // Assert — employment profiles get web+email; the tax CPA gets nothing
    expect(outcome.matchedProfiles.map((p) => p.id)).toEqual(['profile-ca', 'profile-ny']);
    expect(outcome.deliveries).toHaveLength(4);
    expect(outcome.deliveries.map((d) => d.profileId)).not.toContain('profile-fl-tax');
    expect(outcome.delta.publishedAt).toBe('2024-07-01T14:31:00Z');
  });
});
