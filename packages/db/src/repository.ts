import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import {
  canonicalSections,
  deltas,
  reviewRecords,
  sectionVersions,
  sources,
} from './schema.js';

/**
 * Drizzle repository for the publish path (M2). The repository is a thin,
 * honest mapper — the approved-before-publish enforcement lives in the
 * database triggers shipped by migration 0002_trust_gate.sql, so even raw
 * SQL bypassing this module cannot publish an unapproved or unverified
 * delta. Exercised by `just test-db` (requires DATABASE_URL).
 */

export class DbPublicationBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbPublicationBlockedError';
  }
}

/** Postgres SQLSTATE raised by the trust-gate triggers. */
const CHECK_VIOLATION = '23514';

/** Walk the cause chain to the underlying pg error (drizzle wraps it). */
const findPgError = (error: unknown): { code: string; message: string } | undefined => {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === 'object'; depth += 1) {
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string') {
      return {
        code: candidate.code,
        message: typeof candidate.message === 'string' ? candidate.message : '',
      };
    }
    current = candidate.cause;
  }
  return undefined;
};

const rethrowPublishErrors = (error: unknown): never => {
  const pgError = findPgError(error);
  if (pgError?.code === CHECK_VIOLATION) {
    throw new DbPublicationBlockedError(
      pgError.message.length > 0 ? pgError.message : 'Database trust gate refused the write.',
    );
  }
  throw error;
};

export interface CitationRow {
  readonly citation: string;
  readonly sectionVersionId: string;
  readonly quoteSpan: string;
  readonly verifiedAt: string | null;
}

export interface SourceSeed {
  readonly id: string;
  readonly kind: 'federal_register' | 'ecfr' | 'openstates' | 'agency_rss' | 'state_register_pdf';
  readonly jurisdiction: string;
  readonly feedUrl: string;
  readonly parserId: string;
  readonly schedule: string;
}

export interface SectionSeed {
  readonly id: string;
  readonly sourceId: string;
  readonly citation: string;
  readonly heading: string;
  readonly jurisdiction: string;
}

export interface VersionSeed {
  readonly id: string;
  readonly sectionId: string;
  readonly normalizedText: string;
  readonly normalizedParagraphs: readonly string[];
  readonly contentHash: string;
  readonly retrievedAt: string;
  readonly sourceUrl: string;
  readonly supersedesVersionId: string | null;
}

export interface DeltaRow {
  readonly id: string;
  readonly jurisdiction: string;
  readonly topic: string;
  readonly changeEventIds: readonly string[];
  readonly title: string;
  readonly bodyMd: string;
  readonly effectiveDate: string;
  readonly citations: readonly CitationRow[];
  readonly verificationStatus: 'pending' | 'verified' | 'blocked';
}

export interface ReviewRow {
  readonly id: string;
  readonly deltaId: string;
  readonly reviewerId: string;
  readonly status: 'pending' | 'approved' | 'rejected' | 'needs_edit';
  readonly notes: string;
  readonly decidedAt: string | null;
  readonly createdAt: string;
}

export interface PublishRepository {
  seedSource(input: SourceSeed): Promise<void>;
  seedSection(input: SectionSeed): Promise<void>;
  seedVersion(input: VersionSeed): Promise<void>;
  insertDelta(input: DeltaRow): Promise<void>;
  insertReview(input: ReviewRow): Promise<void>;
  /** Set published_at. The DB trigger blocks unapproved/unverified deltas. */
  publishDelta(deltaId: string, publishedAt: string): Promise<Date>;
  getPublishedAt(deltaId: string): Promise<Date | null>;
  close(): Promise<void>;
}

export const createPublishRepository = (databaseUrl: string): PublishRepository => {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
  const db = drizzle(pool);

  return {
    seedSource: async (input) => {
      await db.insert(sources).values({ ...input }).onConflictDoNothing();
    },
    seedSection: async (input) => {
      await db.insert(canonicalSections).values({ ...input }).onConflictDoNothing();
    },
    seedVersion: async (input) => {
      await db
        .insert(sectionVersions)
        .values({
          id: input.id,
          sectionId: input.sectionId,
          normalizedText: input.normalizedText,
          normalizedParagraphs: input.normalizedParagraphs,
          contentHash: input.contentHash,
          retrievedAt: new Date(input.retrievedAt),
          sourceUrl: input.sourceUrl,
          supersedesVersionId: input.supersedesVersionId,
        })
        .onConflictDoNothing();
    },
    insertDelta: async (input) => {
      try {
        await db.insert(deltas).values({
          id: input.id,
          jurisdiction: input.jurisdiction,
          topic: input.topic,
          changeEventIds: input.changeEventIds,
          title: input.title,
          bodyMd: input.bodyMd,
          effectiveDate: input.effectiveDate,
          citations: input.citations,
          verificationStatus: input.verificationStatus,
        });
      } catch (error: unknown) {
        rethrowPublishErrors(error);
      }
    },
    insertReview: async (input) => {
      await db.insert(reviewRecords).values({
        id: input.id,
        deltaId: input.deltaId,
        reviewerId: input.reviewerId,
        status: input.status,
        notes: input.notes,
        decidedAt: input.decidedAt === null ? null : new Date(input.decidedAt),
        createdAt: new Date(input.createdAt),
      });
    },
    publishDelta: async (deltaId, publishedAt) => {
      try {
        const rows = await db
          .update(deltas)
          .set({ publishedAt: new Date(publishedAt) })
          .where(eq(deltas.id, deltaId))
          .returning({ publishedAt: deltas.publishedAt });
        const first = rows[0];
        if (first?.publishedAt == null) {
          throw new Error(`Delta ${deltaId} not found — nothing published.`);
        }
        return first.publishedAt;
      } catch (error: unknown) {
        return rethrowPublishErrors(error);
      }
    },
    getPublishedAt: async (deltaId) => {
      const rows = await db
        .select({ publishedAt: deltas.publishedAt })
        .from(deltas)
        .where(eq(deltas.id, deltaId));
      return rows[0]?.publishedAt ?? null;
    },
    close: async () => {
      await pool.end();
    },
  };
};
