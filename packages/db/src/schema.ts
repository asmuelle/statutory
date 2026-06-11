import {
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle schema for the DESIGN.md data model. M1 ships schema-only: it
 * compiles and type-checks without a live database; migrations are generated
 * with `just migrate` (drizzle-kit) and applied when DATABASE_URL is set.
 *
 * Invariant notes encoded in the shape:
 *  - section_versions is append-only: no updated_at column exists at all
 *    (invariant 7); corrections supersede via supersedes_version_id.
 *  - deltas.citations is a jsonb array of { citation, sectionVersionId,
 *    quoteSpan, verifiedAt } — publication requires every verifiedAt set
 *    plus an approved review_records row (invariant 4; DB-level enforcement
 *    lands in M2 per the milestone plan).
 */

export const sourceKind = pgEnum('source_kind', [
  'federal_register',
  'ecfr',
  'openstates',
  'agency_rss',
  'state_register_pdf',
]);

export const changeEventStatus = pgEnum('change_event_status', [
  'detected',
  'triaged',
  'synthesized',
  'verified',
  'in_review',
  'published',
  'rejected',
  'archived',
  'dead_letter',
]);

export const verificationStatus = pgEnum('verification_status', [
  'pending',
  'verified',
  'blocked',
]);

export const reviewStatus = pgEnum('review_status', [
  'pending',
  'approved',
  'rejected',
  'needs_edit',
]);

export const deliveryChannel = pgEnum('delivery_channel', ['web', 'email', 'slack']);

export const sources = pgTable('sources', {
  id: text('id').primaryKey(),
  kind: sourceKind('kind').notNull(),
  jurisdiction: text('jurisdiction').notNull(),
  feedUrl: text('feed_url').notNull(),
  parserId: text('parser_id').notNull(),
  schedule: text('schedule').notNull(),
  status: text('status').notNull().default('active'),
  lastCrawledAt: timestamp('last_crawled_at', { withTimezone: true }),
});

export const canonicalSections = pgTable(
  'canonical_sections',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id),
    citation: text('citation').notNull(),
    heading: text('heading').notNull(),
    jurisdiction: text('jurisdiction').notNull(),
    topicTags: jsonb('topic_tags').$type<readonly string[]>().notNull().default([]),
    currentVersionId: text('current_version_id'),
    currentHash: text('current_hash'),
  },
  (table) => [uniqueIndex('canonical_sections_citation_idx').on(table.citation)],
);

export const sectionVersions = pgTable('section_versions', {
  id: text('id').primaryKey(),
  sectionId: text('section_id')
    .notNull()
    .references(() => canonicalSections.id),
  normalizedText: text('normalized_text').notNull(),
  normalizedParagraphs: jsonb('normalized_paragraphs').$type<readonly string[]>().notNull(),
  contentHash: text('content_hash').notNull(),
  retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull(),
  sourceUrl: text('source_url').notNull(),
  effectiveDate: date('effective_date'),
  supersedesVersionId: text('supersedes_version_id'),
});

export const changeEvents = pgTable('change_events', {
  id: text('id').primaryKey(),
  sectionId: text('section_id')
    .notNull()
    .references(() => canonicalSections.id),
  oldVersionId: text('old_version_id')
    .notNull()
    .references(() => sectionVersions.id),
  newVersionId: text('new_version_id')
    .notNull()
    .references(() => sectionVersions.id),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull(),
  structuralDiff: jsonb('structural_diff')
    .$type<{ readonly removedParagraphs: readonly string[]; readonly addedParagraphs: readonly string[] }>()
    .notNull(),
  status: changeEventStatus('status').notNull().default('detected'),
});

export const practiceProfiles = pgTable('practice_profiles', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  jurisdictions: jsonb('jurisdictions').$type<readonly string[]>().notNull(),
  practiceAreas: jsonb('practice_areas').$type<readonly string[]>().notNull(),
  clientTypes: jsonb('client_types').$type<readonly string[]>().notNull(),
  topicWeights: jsonb('topic_weights').$type<Readonly<Record<string, number>>>().notNull().default({}),
  correctionHistory: jsonb('correction_history').$type<readonly unknown[]>().notNull().default([]),
});

export const deltas = pgTable('deltas', {
  id: text('id').primaryKey(),
  jurisdiction: text('jurisdiction').notNull(),
  topic: text('topic').notNull(),
  changeEventIds: jsonb('change_event_ids').$type<readonly string[]>().notNull(),
  title: text('title').notNull(),
  bodyMd: text('body_md').notNull(),
  effectiveDate: date('effective_date').notNull(),
  citations: jsonb('citations')
    .$type<
      readonly {
        readonly citation: string;
        readonly sectionVersionId: string;
        readonly quoteSpan: string;
        readonly verifiedAt: string | null;
      }[]
    >()
    .notNull(),
  verificationStatus: verificationStatus('verification_status').notNull().default('pending'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  tokenCost: integer('token_cost').notNull().default(0),
});

export const reviewRecords = pgTable('review_records', {
  id: text('id').primaryKey(),
  deltaId: text('delta_id')
    .notNull()
    .references(() => deltas.id),
  reviewerId: text('reviewer_id').notNull(),
  status: reviewStatus('status').notNull().default('pending'),
  notes: text('notes').notNull().default(''),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
});

export const deliveries = pgTable('deliveries', {
  id: text('id').primaryKey(),
  deltaId: text('delta_id')
    .notNull()
    .references(() => deltas.id),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  channel: deliveryChannel('channel').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
  openedAt: timestamp('opened_at', { withTimezone: true }),
});

export const clientAlerts = pgTable('client_alerts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  deltaId: text('delta_id')
    .notNull()
    .references(() => deltas.id),
  templateId: text('template_id').notNull(),
  renderedDocxUrl: text('rendered_docx_url'),
  exportedAt: timestamp('exported_at', { withTimezone: true }),
});

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  planTier: text('plan_tier').notNull().default('trial'),
  jurisdictionBundles: jsonb('jurisdiction_bundles').$type<readonly string[]>().notNull().default([]),
  coverageManifestAcceptedAt: timestamp('coverage_manifest_accepted_at', { withTimezone: true }),
});
