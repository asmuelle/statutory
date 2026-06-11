import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vitest';

import {
  canonicalSections,
  changeEvents,
  deltas,
  deliveries,
  reviewRecords,
  sectionVersions,
  sources,
  users,
} from './schema.js';

/**
 * Schema-shape tests: no live database required. They pin the invariant-
 * relevant structure so a refactor cannot silently weaken it.
 */
describe('drizzle schema shape', () => {
  test('section_versions is append-only: no updated_at column exists', () => {
    // Act
    const config = getTableConfig(sectionVersions);
    const columnNames = config.columns.map((c) => c.name);

    // Assert (invariant 7)
    expect(columnNames).not.toContain('updated_at');
    expect(columnNames).toEqual(
      expect.arrayContaining([
        'id',
        'section_id',
        'normalized_text',
        'content_hash',
        'retrieved_at',
        'source_url',
        'effective_date',
        'supersedes_version_id',
      ]),
    );
  });

  test('every provenance field on section_versions is NOT NULL', () => {
    // Act
    const config = getTableConfig(sectionVersions);
    const required = ['normalized_text', 'content_hash', 'retrieved_at', 'source_url'];
    const byName = new Map(config.columns.map((c) => [c.name, c]));

    // Assert
    for (const name of required) {
      expect(byName.get(name)?.notNull, `${name} must be NOT NULL`).toBe(true);
    }
  });

  test('canonical_sections has a unique citation index', () => {
    // Act
    const config = getTableConfig(canonicalSections);

    // Assert
    expect(config.indexes.some((i) => i.config.unique)).toBe(true);
  });

  test('change_events pins both old and new version ids', () => {
    // Act
    const columnNames = getTableConfig(changeEvents).columns.map((c) => c.name);

    // Assert
    expect(columnNames).toEqual(
      expect.arrayContaining(['old_version_id', 'new_version_id', 'structural_diff', 'status']),
    );
  });

  test('deltas carry citations, verification status, and effective date as NOT NULL', () => {
    // Act
    const config = getTableConfig(deltas);
    const byName = new Map(config.columns.map((c) => [c.name, c]));

    // Assert
    expect(byName.get('citations')?.notNull).toBe(true);
    expect(byName.get('verification_status')?.notNull).toBe(true);
    expect(byName.get('effective_date')?.notNull).toBe(true);
  });

  test('review_records reference deltas — publication requires an approved row (invariant 4)', () => {
    // Act
    const config = getTableConfig(reviewRecords);
    const deltaId = config.columns.find((c) => c.name === 'delta_id');

    // Assert
    expect(deltaId?.notNull).toBe(true);
    expect(config.foreignKeys.length).toBeGreaterThan(0);
  });

  test('all core tables exist with expected names', () => {
    // Act / Assert
    expect(getTableConfig(sources).name).toBe('sources');
    expect(getTableConfig(canonicalSections).name).toBe('canonical_sections');
    expect(getTableConfig(sectionVersions).name).toBe('section_versions');
    expect(getTableConfig(changeEvents).name).toBe('change_events');
    expect(getTableConfig(deltas).name).toBe('deltas');
    expect(getTableConfig(reviewRecords).name).toBe('review_records');
    expect(getTableConfig(deliveries).name).toBe('deliveries');
    expect(getTableConfig(users).name).toBe('users');
  });
});
