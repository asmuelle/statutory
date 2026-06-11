import { describe, expect, test } from 'vitest';

import { PublicationBlockedError, createMemoryStore } from './store.js';
import type { MemoryStore } from './store.js';

const seed = (store: MemoryStore) =>
  store.seedSection({
    citation: '29 CFR § 541.600',
    heading: '§ 541.600 Amount of salary required.',
    jurisdiction: 'us-federal',
    normalizedParagraphs: ['(a) Not less than $684 per week.'],
    normalizedText: '(a) Not less than $684 per week.',
    contentHash: 'hash-1',
    retrievedAt: '2024-04-01T06:00:00Z',
    sourceUrl: 'https://www.ecfr.gov/current/title-29',
  });

const createVerifiedDelta = (store: MemoryStore, sectionVersionId: string) => {
  const delta = store.createDelta({
    jurisdiction: 'us-federal',
    topic: 'exempt-status',
    changeEventIds: [],
    title: 'Test delta',
    bodyMd: 'body',
    effectiveDate: '2024-07-01',
    citations: [
      { citation: '29 CFR § 541.600', sectionVersionId, quoteSpan: '$684 per week', verifiedAt: null },
    ],
  });
  return store.setDeltaVerification(delta.id, 'verified', [
    {
      citation: '29 CFR § 541.600',
      sectionVersionId,
      quoteSpan: '$684 per week',
      verifiedAt: '2024-07-01T06:05:00Z',
    },
  ]);
};

describe('append-only provenance (invariant 7)', () => {
  test('appending a version supersedes but never deletes the prior version', () => {
    // Arrange
    const store = createMemoryStore();
    const section = seed(store);

    // Act
    const v2 = store.appendVersion({
      sectionId: section.id,
      normalizedParagraphs: ['(a) Not less than $844 per week.'],
      normalizedText: '(a) Not less than $844 per week.',
      contentHash: 'hash-2',
      retrievedAt: '2024-07-01T06:00:00Z',
      sourceUrl: 'https://www.ecfr.gov/current/title-29',
    });

    // Assert
    const versions = store.listVersionsForSection(section.id);
    expect(versions).toHaveLength(2);
    expect(v2.supersedesVersionId).toBe(versions[0]?.id);
    expect(store.getVersion(versions[0]?.id ?? '')?.normalizedText).toContain('$684');
    expect(store.getSection(section.id)?.currentVersionId).toBe(v2.id);
  });

  test('stored versions are frozen — mutation attempts throw', () => {
    // Arrange
    const store = createMemoryStore();
    const section = seed(store);
    const version = store.getVersion(section.currentVersionId);

    // Act / Assert
    expect(() => {
      (version as { normalizedText: string }).normalizedText = 'tampered';
    }).toThrow(TypeError);
  });

  test('seeding the same citation twice is rejected', () => {
    // Arrange
    const store = createMemoryStore();
    seed(store);

    // Act / Assert
    expect(() => seed(store)).toThrow(/already exists/);
  });
});

describe('publication gate in the storage layer (invariant 4)', () => {
  test('publishing without any review record is blocked', () => {
    // Arrange
    const store = createMemoryStore();
    const section = seed(store);
    const delta = createVerifiedDelta(store, section.currentVersionId);

    // Act / Assert
    expect(() => store.publishDelta(delta.id, '2024-07-01T14:31:00Z')).toThrow(
      PublicationBlockedError,
    );
  });

  test('publishing with a rejected review is blocked', () => {
    // Arrange
    const store = createMemoryStore();
    const section = seed(store);
    const delta = createVerifiedDelta(store, section.currentVersionId);
    store.recordReview({
      deltaId: delta.id,
      reviewerId: 'attorney-1',
      status: 'rejected',
      notes: 'Wrong scope.',
      decidedAt: '2024-07-01T14:00:00Z',
    });

    // Act / Assert
    expect(() => store.publishDelta(delta.id, '2024-07-01T14:31:00Z')).toThrow(
      /no approved review/,
    );
  });

  test('publishing an unverified (blocked) delta is impossible even when "approved"', () => {
    // Arrange — simulates a rogue code path approving a gate-blocked delta
    const store = createMemoryStore();
    const section = seed(store);
    const delta = store.createDelta({
      jurisdiction: 'us-federal',
      topic: 'exempt-status',
      changeEventIds: [],
      title: 'Blocked delta',
      bodyMd: 'body',
      effectiveDate: '2024-07-01',
      citations: [
        {
          citation: '29 CFR § 541.600',
          sectionVersionId: section.currentVersionId,
          quoteSpan: 'paraphrased text',
          verifiedAt: null,
        },
      ],
    });
    store.setDeltaVerification(delta.id, 'blocked', delta.citations);
    store.recordReview({
      deltaId: delta.id,
      reviewerId: 'attorney-1',
      status: 'approved',
      notes: 'Approving anyway (must not work).',
      decidedAt: '2024-07-01T14:00:00Z',
    });

    // Act / Assert
    expect(() => store.publishDelta(delta.id, '2024-07-01T14:31:00Z')).toThrow(
      /not 'verified'/,
    );
  });

  test('approved + verified publishes and stamps publishedAt', () => {
    // Arrange
    const store = createMemoryStore();
    const section = seed(store);
    const delta = createVerifiedDelta(store, section.currentVersionId);
    store.recordReview({
      deltaId: delta.id,
      reviewerId: 'attorney-1',
      status: 'approved',
      notes: 'OK.',
      decidedAt: '2024-07-01T14:00:00Z',
    });

    // Act
    const published = store.publishDelta(delta.id, '2024-07-01T14:31:00Z');

    // Assert
    expect(published.publishedAt).toBe('2024-07-01T14:31:00Z');
  });

  test('deliveries for unpublished deltas are refused', () => {
    // Arrange
    const store = createMemoryStore();
    const section = seed(store);
    const delta = createVerifiedDelta(store, section.currentVersionId);

    // Act / Assert
    expect(() =>
      store.addDelivery({
        deltaId: delta.id,
        profileId: 'profile-demo-ca',
        channel: 'email',
        sentAt: '2024-07-01T14:31:00Z',
      }),
    ).toThrow(PublicationBlockedError);
  });
});

describe('review trail', () => {
  test('keeps every review record as an audit trail (append-only)', () => {
    // Arrange
    const store = createMemoryStore();
    const section = seed(store);
    const delta = createVerifiedDelta(store, section.currentVersionId);

    // Act
    store.recordReview({
      deltaId: delta.id,
      reviewerId: 'system-gate',
      status: 'pending',
      notes: 'Gate passed.',
      decidedAt: null,
    });
    store.recordReview({
      deltaId: delta.id,
      reviewerId: 'attorney-1',
      status: 'approved',
      notes: 'Checked.',
      decidedAt: '2024-07-01T14:00:00Z',
    });

    // Assert
    expect(store.reviewTrail(delta.id).map((r) => r.status)).toEqual(['pending', 'approved']);
    expect(store.latestReview(delta.id)?.status).toBe('approved');
  });
});
