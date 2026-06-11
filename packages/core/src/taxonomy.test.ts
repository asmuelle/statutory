import { describe, expect, test } from 'vitest';

import { matchProfiles } from './profileMatch.js';
import { parseCfrCitation, topicById, topicForCitation } from './taxonomy.js';
import type { PracticeProfile } from './types.js';

describe('parseCfrCitation', () => {
  test('parses title and part from a section citation', () => {
    // Act / Assert
    expect(parseCfrCitation('29 CFR § 541.600')).toEqual({ title: 29, part: 541 });
  });

  test('returns undefined for non-CFR citations', () => {
    // Act / Assert
    expect(parseCfrCitation('Cal. Lab. Code § 512')).toBeUndefined();
  });
});

describe('topicForCitation', () => {
  test('maps part 541 to exempt-status', () => {
    expect(topicForCitation('29 CFR § 541.600')?.id).toBe('exempt-status');
  });

  test('maps part 778 to overtime and part 785 to hours-worked', () => {
    expect(topicForCitation('29 CFR § 778.101')?.id).toBe('overtime');
    expect(topicForCitation('29 CFR § 785.1')?.id).toBe('hours-worked');
  });

  test('returns undefined for unmonitored parts', () => {
    expect(topicForCitation('29 CFR § 825.100')).toBeUndefined();
  });
});

describe('topicById', () => {
  test('throws on unknown ids', () => {
    // Act / Assert
    expect(() => topicById('nonexistent' as never)).toThrow(/Unknown topic id/);
  });
});

describe('matchProfiles (fan-out targeting)', () => {
  const caEmploymentLawyer: PracticeProfile = {
    id: 'profile-ca',
    name: 'CA employment lawyer',
    jurisdictions: ['us-federal', 'us-ca'],
    practiceAreas: ['employment'],
    clientTypes: ['small-business'],
  };
  const nyHrConsultant: PracticeProfile = {
    id: 'profile-ny',
    name: 'NY HR consultant',
    jurisdictions: ['us-federal', 'us-ny'],
    practiceAreas: ['employment'],
    clientTypes: ['mid-market'],
  };
  const flTaxCpa: PracticeProfile = {
    id: 'profile-fl',
    name: 'FL tax CPA',
    jurisdictions: ['us-federal', 'us-fl'],
    practiceAreas: ['tax'],
    clientTypes: ['s-corps'],
  };

  test('a federal employment delta reaches exactly the employment profiles', () => {
    // Arrange
    const profiles = [caEmploymentLawyer, nyHrConsultant, flTaxCpa];

    // Act
    const matched = matchProfiles('us-federal', 'exempt-status', profiles);

    // Assert
    expect(matched.map((p) => p.id)).toEqual(['profile-ca', 'profile-ny']);
  });

  test('a profile without the jurisdiction is excluded', () => {
    // Arrange
    const caOnly: PracticeProfile = { ...caEmploymentLawyer, jurisdictions: ['us-ca'] };

    // Act
    const matched = matchProfiles('us-federal', 'exempt-status', [caOnly]);

    // Assert
    expect(matched).toEqual([]);
  });
});
