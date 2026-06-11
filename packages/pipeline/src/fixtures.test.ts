import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { defaultFixturesDir, findWorkspaceRoot, readFixture } from './fixtures.js';

describe('findWorkspaceRoot', () => {
  test('locates the pnpm workspace root from a nested directory', () => {
    // Act
    const root = findWorkspaceRoot(join(process.cwd(), 'packages', 'pipeline', 'src'));

    // Assert
    expect(root).toBe(process.cwd());
  });

  test('throws an explicit error when no workspace root exists', () => {
    // Arrange
    const orphan = mkdtempSync(join(tmpdir(), 'statutory-orphan-'));

    try {
      // Act / Assert
      expect(() => findWorkspaceRoot(orphan)).toThrow(/Could not locate pnpm-workspace.yaml/);
    } finally {
      rmSync(orphan, { recursive: true, force: true });
    }
  });
});

describe('defaultFixturesDir', () => {
  afterEach(() => {
    delete process.env['STATUTORY_FIXTURES_DIR'];
  });

  test('honors the STATUTORY_FIXTURES_DIR override', () => {
    // Arrange
    process.env['STATUTORY_FIXTURES_DIR'] = '/tmp/custom-fixtures';

    // Act / Assert
    expect(defaultFixturesDir()).toBe('/tmp/custom-fixtures');
  });

  test('falls back to the workspace fixtures directory', () => {
    // Act / Assert
    expect(defaultFixturesDir()).toBe(
      join(process.cwd(), 'packages', 'pipeline', 'fixtures'),
    );
  });
});

describe('readFixture', () => {
  test('reads an existing fixture file', () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), 'statutory-fixtures-'));
    writeFileSync(join(dir, 'sample.txt'), 'hello', 'utf8');

    try {
      // Act / Assert
      expect(readFixture(dir, 'sample.txt')).toBe('hello');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('throws an actionable error for a missing fixture', () => {
    // Act / Assert
    expect(() => readFixture('/nonexistent-dir', 'nope.xml')).toThrow(/Failed to read fixture/);
  });
});
