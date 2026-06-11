import pg from 'pg';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { createReviewQueueFixture } from '@statutory/pipeline';
import type { ReviewQueueFixture } from '@statutory/pipeline';

import { DbPublicationBlockedError, createPublishRepository } from './repository.js';
import type { PublishRepository, ReviewRow } from './repository.js';

/**
 * DB-enforced trust gate integration suite (`just test-db`). Replays the
 * seeded-mutation pipeline output into Postgres and proves the trigger
 * shipped in 0002_trust_gate.sql blocks every unapproved/unverified publish
 * path — including raw SQL that bypasses the repository entirely.
 *
 * Requires DATABASE_URL with migrations applied (just db-up && just migrate);
 * skipped otherwise so `just ci` stays green without docker.
 */

const DATABASE_URL = process.env['DATABASE_URL'] ?? '';
const T_PUBLISH = '2024-07-01T14:31:00Z';
const T_BASE_MS = Date.parse('2024-07-01T06:05:00Z');

const CHECK_VIOLATION = '23514';

describe.skipIf(DATABASE_URL === '')('DB publish gate (migration 0002_trust_gate)', () => {
  const repo: PublishRepository = createPublishRepository(DATABASE_URL || 'postgres://unused');
  const raw = new pg.Pool({ connectionString: DATABASE_URL || 'postgres://unused', max: 2 });

  afterAll(async () => {
    await repo.close();
    await raw.end();
  });

  /** Persist the fixture store (sections, versions, deltas, audit trail). */
  const persistFixture = async (fixture: ReviewQueueFixture): Promise<void> => {
    await repo.seedSource({
      id: 'src-ecfr-title29',
      kind: 'ecfr',
      jurisdiction: 'us-federal',
      feedUrl: 'https://www.ecfr.gov/current/title-29',
      parserId: 'ecfr-xml',
      schedule: 'daily',
    });
    for (const section of fixture.store.listSections()) {
      await repo.seedSection({
        id: section.id,
        sourceId: 'src-ecfr-title29',
        citation: section.citation,
        heading: section.heading,
        jurisdiction: section.jurisdiction,
      });
      for (const version of fixture.store.listVersionsForSection(section.id)) {
        await repo.seedVersion({
          id: version.id,
          sectionId: version.sectionId,
          normalizedText: version.normalizedText,
          normalizedParagraphs: version.normalizedParagraphs,
          contentHash: version.contentHash,
          retrievedAt: version.retrievedAt,
          sourceUrl: version.sourceUrl,
          supersedesVersionId: version.supersedesVersionId,
        });
      }
    }
    for (const delta of fixture.store.listDeltas()) {
      await repo.insertDelta({
        id: delta.id,
        jurisdiction: delta.jurisdiction,
        topic: delta.topic,
        changeEventIds: delta.changeEventIds,
        title: delta.title,
        bodyMd: delta.bodyMd,
        effectiveDate: delta.effectiveDate,
        citations: delta.citations,
        verificationStatus: delta.verificationStatus,
      });
      const trail = fixture.store.reviewTrail(delta.id);
      for (const [index, record] of trail.entries()) {
        await repo.insertReview(toReviewRow(record, index));
      }
    }
  };

  const toReviewRow = (
    record: { id: string; deltaId: string; reviewerId: string; status: ReviewRow['status']; notes: string; decidedAt: string | null },
    index: number,
  ): ReviewRow => ({
    id: `${record.deltaId}-${record.id}`,
    deltaId: record.deltaId,
    reviewerId: record.reviewerId,
    status: record.status,
    notes: record.notes,
    decidedAt: record.decidedAt,
    createdAt: new Date(T_BASE_MS + index * 1000).toISOString(),
  });

  const approveRow = (deltaId: string, atOffsetSeconds: number): ReviewRow => ({
    id: `${deltaId}-rev-approve-${atOffsetSeconds}`,
    deltaId,
    reviewerId: 'attorney-db',
    status: 'approved',
    notes: 'Approved in DB integration test.',
    decidedAt: new Date(T_BASE_MS + atOffsetSeconds * 1000).toISOString(),
    createdAt: new Date(T_BASE_MS + atOffsetSeconds * 1000).toISOString(),
  });

  let fixture: ReviewQueueFixture;

  beforeEach(async () => {
    // TRUNCATE fires no row-level triggers, so append-only stays intact for DML.
    await raw.query(
      'TRUNCATE deliveries, client_alerts, review_records, deltas, change_events, ' +
        'section_versions, canonical_sections, practice_profiles, users, sources CASCADE',
    );
    fixture = await createReviewQueueFixture();
    await persistFixture(fixture);
  });

  test('migrations installed the publish-gate trigger on deltas', async () => {
    // Act
    const result = await raw.query(
      "SELECT tgname FROM pg_trigger WHERE tgname IN ('deltas_publish_gate', 'deltas_published_immutable', 'section_versions_append_only', 'review_records_append_only')",
    );

    // Assert
    expect(result.rows.map((r: { tgname: string }) => r.tgname).sort()).toEqual([
      'deltas_publish_gate',
      'deltas_published_immutable',
      'review_records_append_only',
      'section_versions_append_only',
    ]);
  });

  test('a verified delta whose latest review is approved publishes', async () => {
    // Arrange
    await repo.insertReview(approveRow(fixture.pendingDeltaId, 600));

    // Act
    const publishedAt = await repo.publishDelta(fixture.pendingDeltaId, T_PUBLISH);

    // Assert
    expect(publishedAt.toISOString()).toBe(new Date(T_PUBLISH).toISOString());
  });

  test('publishing with only the gate-pending review record is blocked by the DB', async () => {
    // Act / Assert — no human approval exists yet
    await expect(repo.publishDelta(fixture.pendingDeltaId, T_PUBLISH)).rejects.toThrow(
      DbPublicationBlockedError,
    );
    expect(await repo.getPublishedAt(fixture.pendingDeltaId)).toBeNull();
  });

  test('an approval that is later superseded by needs_edit no longer publishes', async () => {
    // Arrange — approved at +600s, then sent back to edit at +700s
    await repo.insertReview(approveRow(fixture.pendingDeltaId, 600));
    await repo.insertReview({
      id: `${fixture.pendingDeltaId}-rev-needs-edit`,
      deltaId: fixture.pendingDeltaId,
      reviewerId: 'attorney-db',
      status: 'needs_edit',
      notes: 'Second look: tighten the quote.',
      decidedAt: new Date(T_BASE_MS + 700_000).toISOString(),
      createdAt: new Date(T_BASE_MS + 700_000).toISOString(),
    });

    // Act / Assert — latest review is not approved
    await expect(repo.publishDelta(fixture.pendingDeltaId, T_PUBLISH)).rejects.toThrow(
      /not 'approved'/,
    );
  });

  test('SEEDED MUTATION: the gate-blocked corrupted delta cannot publish even with a rogue approval', async () => {
    // Arrange — a rogue approval lands on the $884-corrupted delta
    await repo.insertReview(approveRow(fixture.blockedDeltaId, 600));

    // Act / Assert — verification_status is 'blocked'; the DB refuses
    await expect(repo.publishDelta(fixture.blockedDeltaId, T_PUBLISH)).rejects.toThrow(
      DbPublicationBlockedError,
    );
    expect(await repo.getPublishedAt(fixture.blockedDeltaId)).toBeNull();
  });

  test('SEEDED MUTATION: a verifiedAt stamp stripped from one citation blocks publish', async () => {
    // Arrange — verified delta, approved review, but one stamp mutated to null
    await repo.insertReview(approveRow(fixture.pendingDeltaId, 600));
    const delta = fixture.store.getDelta(fixture.pendingDeltaId);
    const mutated = (delta?.citations ?? []).map((c, i) =>
      i === 0 ? { ...c, verifiedAt: null } : c,
    );
    await raw.query('UPDATE deltas SET citations = $1::jsonb WHERE id = $2', [
      JSON.stringify(mutated),
      fixture.pendingDeltaId,
    ]);

    // Act / Assert
    await expect(repo.publishDelta(fixture.pendingDeltaId, T_PUBLISH)).rejects.toThrow(
      /verifiedAt/,
    );
  });

  test('raw SQL bypassing the repository cannot publish either', async () => {
    // Act — UPDATE straight at the table, no repository involved
    const update = raw.query('UPDATE deltas SET published_at = now() WHERE id = $1', [
      fixture.pendingDeltaId,
    ]);

    // Assert
    await expect(update).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  test('raw INSERT of an already-published delta with no review trail is refused', async () => {
    // Act
    const insert = raw.query(
      `INSERT INTO deltas (id, jurisdiction, topic, change_event_ids, title, body_md,
         effective_date, citations, verification_status, published_at)
       VALUES ('delta-smuggled', 'us-federal', 'exempt-status', '[]'::jsonb, 'Smuggled', 'body',
         '2024-07-01', '[{"citation":"x","sectionVersionId":"v","quoteSpan":"q","verifiedAt":"2024-07-01T00:00:00Z"}]'::jsonb,
         'verified', now())`,
    );

    // Assert
    await expect(insert).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  test('published deltas are immutable in the DB', async () => {
    // Arrange
    await repo.insertReview(approveRow(fixture.pendingDeltaId, 600));
    await repo.publishDelta(fixture.pendingDeltaId, T_PUBLISH);

    // Act / Assert — content tampering and unpublishing both refused
    await expect(
      raw.query("UPDATE deltas SET title = 'tampered' WHERE id = $1", [fixture.pendingDeltaId]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    await expect(
      raw.query('UPDATE deltas SET published_at = NULL WHERE id = $1', [fixture.pendingDeltaId]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  test('section_versions is append-only at the DB level (invariant 7)', async () => {
    // Arrange
    const anyVersion = await raw.query('SELECT id FROM section_versions LIMIT 1');
    const versionId = (anyVersion.rows[0] as { id: string }).id;

    // Act / Assert
    await expect(
      raw.query("UPDATE section_versions SET normalized_text = 'doctored' WHERE id = $1", [
        versionId,
      ]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    await expect(
      raw.query('DELETE FROM section_versions WHERE id = $1', [versionId]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  test('the review audit trail cannot be doctored after the fact', async () => {
    // Arrange
    const anyReview = await raw.query('SELECT id FROM review_records LIMIT 1');
    const reviewId = (anyReview.rows[0] as { id: string }).id;

    // Act / Assert
    await expect(
      raw.query("UPDATE review_records SET status = 'approved' WHERE id = $1", [reviewId]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    await expect(
      raw.query('DELETE FROM review_records WHERE id = $1', [reviewId]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });
});
