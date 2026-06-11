import { describe, expect, test } from 'vitest';

import { ReviewTransitionError } from '@statutory/core';
import type { PracticeProfile } from '@statutory/core';

import { defaultFixturesDir, readFixture } from './fixtures.js';
import {
  createMockSynthesisModel,
  createMockTriageModel,
  withQuoteCorruption,
} from './llm/mockModels.js';
import { crawlSections, synthesizeDeltas, triageChangeEvents, verifyDelta } from './pipeline.js';
import { approveAndPublish, editDelta, rejectDelta, workflowStateOf } from './review.js';
import { parseEcfrXml } from './sources/ecfr.js';
import { parseFederalRegisterDoc } from './sources/federalRegister.js';
import { PublicationBlockedError, createMemoryStore } from './store.js';
import type { MemoryStore } from './store.js';

const FIXTURES = defaultFixturesDir();
const PARSE_OPTIONS = { cfrTitle: 29, sourceUrl: 'https://www.ecfr.gov/current/title-29' };
const T_EDIT = '2024-07-01T10:00:00Z';
const T_DECIDE = '2024-07-01T14:30:00Z';

const PROFILES: readonly PracticeProfile[] = [
  {
    id: 'profile-ca',
    name: 'CA employment lawyer',
    jurisdictions: ['us-federal', 'us-ca'],
    practiceAreas: ['employment'],
    clientTypes: [],
  },
];

const loadSections = (file: string) =>
  parseEcfrXml(readFixture(FIXTURES, `ecfr/${file}`), PARSE_OPTIONS);

const frDoc = () =>
  parseFederalRegisterDoc(readFixture(FIXTURES, 'federal-register/2024-08038.json'));

/** Crawl baseline + amendment, triage, synthesize one delta; gate NOT yet run. */
const synthesizeDraft = async (options?: { readonly corruptQuotes?: boolean }) => {
  const store = createMemoryStore();
  crawlSections(store, loadSections('title29-chapterV-2024-04-01.xml'), {
    jurisdiction: 'us-federal',
    retrievedAt: '2024-04-01T06:00:00Z',
  });
  const report = crawlSections(store, loadSections('title29-chapterV-2024-07-01.xml'), {
    jurisdiction: 'us-federal',
    retrievedAt: '2024-07-01T06:00:00Z',
  });
  const outcomes = await triageChangeEvents(
    store,
    report.changeEvents,
    createMockTriageModel(),
    'us-federal',
    PROFILES,
  );
  const synthesis = options?.corruptQuotes
    ? withQuoteCorruption(createMockSynthesisModel(), (q) => q.replace('$844', '$884'))
    : createMockSynthesisModel();
  const [first] = await synthesizeDeltas(store, outcomes, synthesis, frDoc());
  if (first === undefined) {
    throw new Error('Test harness: no delta synthesized.');
  }
  return { store, deltaId: first.deltaId };
};

/** Same as synthesizeDraft, but with the deterministic gate already run. */
const synthesizeAndGate = async (options?: { readonly corruptQuotes?: boolean }) => {
  const ctx = await synthesizeDraft(options);
  verifyDelta(ctx.store, ctx.deltaId, frDoc(), '2024-07-01T06:05:00Z');
  return ctx;
};

const approve = (store: MemoryStore, deltaId: string) =>
  approveAndPublish(store, {
    deltaId,
    reviewerId: 'attorney-1',
    notes: 'Verified against the July 1 snapshot.',
    decidedAt: T_DECIDE,
    profiles: PROFILES,
  });

describe('state machine: drafts cannot publish unreviewed', () => {
  test('a draft whose gate has not run cannot be approved at all', async () => {
    // Arrange
    const { store, deltaId } = await synthesizeDraft();

    // Act / Assert
    expect(workflowStateOf(store, deltaId)).toBe('draft');
    expect(() => approve(store, deltaId)).toThrow(ReviewTransitionError);
    expect(store.getDelta(deltaId)?.publishedAt).toBeNull();
  });

  test('a gate-passed delta still cannot publish without an approval decision', async () => {
    // Arrange
    const { store, deltaId } = await synthesizeAndGate();

    // Act / Assert — direct store publish bypassing the review op
    expect(workflowStateOf(store, deltaId)).toBe('awaiting_review');
    expect(() => store.publishDelta(deltaId, T_DECIDE)).toThrow(PublicationBlockedError);
  });

  test('a gate-blocked delta cannot be approved by any reviewer', async () => {
    // Arrange
    const { store, deltaId } = await synthesizeAndGate({ corruptQuotes: true });

    // Act / Assert
    expect(workflowStateOf(store, deltaId)).toBe('gate_blocked');
    expect(() => approve(store, deltaId)).toThrow(ReviewTransitionError);
  });

  test('approving an awaiting_review delta publishes, fans out, and stamps the audit trail', async () => {
    // Arrange
    const { store, deltaId } = await synthesizeAndGate();

    // Act
    const outcome = approve(store, deltaId);

    // Assert
    expect(outcome.delta.publishedAt).toBe(T_DECIDE);
    expect(outcome.deliveries.length).toBeGreaterThan(0);
    expect(workflowStateOf(store, deltaId)).toBe('published');
    const trail = store.reviewTrail(deltaId);
    expect(trail.at(-1)?.status).toBe('approved');
    expect(trail.at(-1)?.reviewerId).toBe('attorney-1');
  });

  test('approving twice is impossible — published is terminal', async () => {
    // Arrange
    const { store, deltaId } = await synthesizeAndGate();
    approve(store, deltaId);

    // Act / Assert
    expect(() => approve(store, deltaId)).toThrow(ReviewTransitionError);
  });
});

describe('state machine: edits re-run the span/effective-date gate', () => {
  test('fixing a corrupted quote re-runs the gate and unblocks the delta', async () => {
    // Arrange — gate-blocked because the mock paraphrased $844 -> $884
    const { store, deltaId } = await synthesizeAndGate({ corruptQuotes: true });
    const blocked = store.getDelta(deltaId);
    const corrected = blocked?.citations.map((c) => ({
      citation: c.citation,
      sectionVersionId: c.sectionVersionId,
      quoteSpan: c.quoteSpan.replace('$884', '$844'),
    }));

    // Act
    const gate = editDelta(
      store,
      { deltaId, editorId: 'attorney-1', patch: { citations: corrected ?? [] }, editedAt: T_EDIT },
      frDoc(),
    );

    // Assert — gate re-ran and passed; delta is reviewable again
    expect(gate.ok).toBe(true);
    expect(workflowStateOf(store, deltaId)).toBe('awaiting_review');
    expect(store.getDelta(deltaId)?.citations.every((c) => c.verifiedAt !== null)).toBe(true);
  });

  test('an edit that corrupts a quote is caught by the re-run gate and blocks approval', async () => {
    // Arrange — healthy delta awaiting review
    const { store, deltaId } = await synthesizeAndGate();
    const healthy = store.getDelta(deltaId);
    const corrupted = healthy?.citations.map((c) => ({
      citation: c.citation,
      sectionVersionId: c.sectionVersionId,
      quoteSpan: c.quoteSpan.replace('salary level', 'pay level'),
    }));

    // Act
    const gate = editDelta(
      store,
      { deltaId, editorId: 'attorney-2', patch: { citations: corrupted ?? [] }, editedAt: T_EDIT },
      frDoc(),
    );

    // Assert
    expect(gate.ok).toBe(false);
    expect(workflowStateOf(store, deltaId)).toBe('gate_blocked');
    expect(() => approve(store, deltaId)).toThrow(ReviewTransitionError);
  });

  test('an edit that skews the effective date is blocked by the cross-check', async () => {
    // Arrange
    const { store, deltaId } = await synthesizeAndGate();

    // Act
    const gate = editDelta(
      store,
      { deltaId, editorId: 'attorney-1', patch: { effectiveDate: '2024-04-26' }, editedAt: T_EDIT },
      frDoc(),
    );

    // Assert
    expect(gate.ok).toBe(false);
    expect(gate.failures.some((f) => f.kind === 'effective_date_mismatch')).toBe(true);
    expect(workflowStateOf(store, deltaId)).toBe('gate_blocked');
  });

  test('every edit strips verification stamps until the gate re-stamps them', async () => {
    // Arrange
    const { store, deltaId } = await synthesizeAndGate();
    expect(store.getDelta(deltaId)?.citations.every((c) => c.verifiedAt !== null)).toBe(true);

    // Act — patch only the title; quotes untouched
    const draft = store.updateDeltaDraft(deltaId, { title: 'Retitled for clarity' });

    // Assert — stamps gone, verification reset; publish is impossible until re-gated
    expect(draft.verificationStatus).toBe('pending');
    expect(draft.citations.every((c) => c.verifiedAt === null)).toBe(true);
    expect(() => store.publishDelta(deltaId, T_DECIDE)).toThrow(PublicationBlockedError);
  });

  test('published deltas are immutable — edits and draft patches both refuse', async () => {
    // Arrange
    const { store, deltaId } = await synthesizeAndGate();
    approve(store, deltaId);

    // Act / Assert
    expect(() =>
      editDelta(
        store,
        { deltaId, editorId: 'attorney-1', patch: { title: 'tamper' }, editedAt: T_EDIT },
        frDoc(),
      ),
    ).toThrow(ReviewTransitionError);
    expect(() => store.updateDeltaDraft(deltaId, { title: 'tamper' })).toThrow(/immutable/);
  });

  test('the audit trail records the edit and the gate outcome, append-only', async () => {
    // Arrange
    const { store, deltaId } = await synthesizeAndGate({ corruptQuotes: true });
    const before = store.reviewTrail(deltaId).length;
    const blocked = store.getDelta(deltaId);
    const corrected = blocked?.citations.map((c) => ({
      citation: c.citation,
      sectionVersionId: c.sectionVersionId,
      quoteSpan: c.quoteSpan.replace('$884', '$844'),
    }));

    // Act
    editDelta(
      store,
      { deltaId, editorId: 'attorney-1', patch: { citations: corrected ?? [] }, editedAt: T_EDIT },
      frDoc(),
    );

    // Assert — one needs_edit entry from the editor, one fresh gate entry
    const trail = store.reviewTrail(deltaId);
    expect(trail.length).toBe(before + 2);
    expect(trail.at(-2)?.status).toBe('needs_edit');
    expect(trail.at(-2)?.reviewerId).toBe('attorney-1');
    expect(trail.at(-2)?.notes).toMatch(/citations/);
    expect(trail.at(-1)?.reviewerId).toBe('system-gate');
  });
});

describe('state machine: rejections record reasons', () => {
  test('rejecting without a reason is refused and nothing is recorded', async () => {
    // Arrange
    const { store, deltaId } = await synthesizeAndGate();
    const before = store.reviewTrail(deltaId).length;

    // Act / Assert
    expect(() =>
      rejectDelta(store, { deltaId, reviewerId: 'attorney-1', reason: '   ', decidedAt: T_DECIDE }),
    ).toThrow(/reason/i);
    expect(store.reviewTrail(deltaId).length).toBe(before);
    expect(workflowStateOf(store, deltaId)).toBe('awaiting_review');
  });

  test('a rejection records the reason and marks the change events rejected', async () => {
    // Arrange
    const { store, deltaId } = await synthesizeAndGate();

    // Act
    const record = rejectDelta(store, {
      deltaId,
      reviewerId: 'attorney-1',
      reason: 'Scope error: the threshold applies to §541.601 highly-compensated employees.',
      decidedAt: T_DECIDE,
    });

    // Assert
    expect(record.status).toBe('rejected');
    expect(record.notes).toMatch(/Scope error/);
    expect(workflowStateOf(store, deltaId)).toBe('rejected');
    const delta = store.getDelta(deltaId);
    for (const eventId of delta?.changeEventIds ?? []) {
      expect(store.getChangeEvent(eventId)?.status).toBe('rejected');
    }
  });

  test('a rejected delta is terminal: no approval, no publication', async () => {
    // Arrange
    const { store, deltaId } = await synthesizeAndGate();
    rejectDelta(store, {
      deltaId,
      reviewerId: 'attorney-1',
      reason: 'Duplicate of an already-published delta.',
      decidedAt: T_DECIDE,
    });

    // Act / Assert
    expect(() => approve(store, deltaId)).toThrow(ReviewTransitionError);
    expect(() => store.publishDelta(deltaId, T_DECIDE)).toThrow(PublicationBlockedError);
  });
});
