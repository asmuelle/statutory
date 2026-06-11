import { describe, expect, test } from 'vitest';

import { M1_COVERAGE_MANIFEST, NOT_LEGAL_ADVICE, renderCoverageStatement } from './coverage.js';

describe('coverage manifest (invariant 8)', () => {
  test('M1 manifest is scoped to the federal employment slice only', () => {
    // Assert
    expect(M1_COVERAGE_MANIFEST.jurisdictions).toEqual(['us-federal']);
    expect(M1_COVERAGE_MANIFEST.topics).toEqual(['exempt-status', 'overtime', 'hours-worked']);
  });

  test('rendered statement names monitored sources AND what is not monitored', () => {
    // Act
    const statement = renderCoverageStatement(M1_COVERAGE_MANIFEST);

    // Assert
    expect(statement).toContain('Monitored: us-federal');
    expect(statement).toContain('eCFR Title 29 Parts 541, 778, 785');
    expect(statement).toContain('NOT monitored:');
    expect(statement).toContain('State and local ordinances');
  });

  test('the not-legal-advice framing is defined and explicit', () => {
    // Assert
    expect(NOT_LEGAL_ADVICE).toMatch(/not legal advice/i);
  });
});
