import { describe, expect, test } from 'vitest';

import { defaultFixturesDir, readFixture } from '../fixtures.js';
import { FederalRegisterParseError, parseFederalRegisterDoc } from './federalRegister.js';

describe('parseFederalRegisterDoc (golden fixture)', () => {
  test('parses the 2024 DOL final rule document', () => {
    // Arrange
    const payload = readFixture(defaultFixturesDir(), 'federal-register/2024-08038.json');

    // Act
    const doc = parseFederalRegisterDoc(payload);

    // Assert
    expect(doc.document_number).toBe('2024-08038');
    expect(doc.effective_on).toBe('2024-07-01');
    expect(doc.citation).toBe('89 FR 32842');
    expect(doc.cfr_references).toEqual([{ title: 29, part: 541 }]);
  });

  test('rejects invalid JSON with an explicit error', () => {
    // Act / Assert
    expect(() => parseFederalRegisterDoc('{not json')).toThrow(FederalRegisterParseError);
  });

  test('rejects a payload missing required fields', () => {
    // Arrange
    const incomplete = JSON.stringify({ document_number: 'x' });

    // Act / Assert
    expect(() => parseFederalRegisterDoc(incomplete)).toThrow(/Schema validation failed/);
  });

  test('rejects a malformed effective_on date', () => {
    // Arrange
    const payload = readFixture(defaultFixturesDir(), 'federal-register/2024-08038.json');
    const doc: Record<string, unknown> = JSON.parse(payload) as Record<string, unknown>;
    const corrupted = JSON.stringify({ ...doc, effective_on: 'July 1, 2024' });

    // Act / Assert
    expect(() => parseFederalRegisterDoc(corrupted)).toThrow(FederalRegisterParseError);
  });
});
