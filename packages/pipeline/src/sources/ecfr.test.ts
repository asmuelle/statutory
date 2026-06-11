import { describe, expect, test } from 'vitest';

import { defaultFixturesDir, readFixture } from '../fixtures.js';
import { EcfrParseError, parseEcfrXml } from './ecfr.js';

const OPTIONS = { cfrTitle: 29, sourceUrl: 'https://www.ecfr.gov/current/title-29' };

describe('parseEcfrXml (golden fixture)', () => {
  const xml = readFixture(defaultFixturesDir(), 'ecfr/title29-chapterV-2024-04-01.xml');

  test('extracts every DIV8 section from the baseline snapshot', () => {
    // Act
    const sections = parseEcfrXml(xml, OPTIONS);

    // Assert
    expect(sections.map((s) => s.citation)).toEqual([
      '29 CFR § 541.600',
      '29 CFR § 541.602',
      '29 CFR § 778.101',
      '29 CFR § 785.1',
    ]);
  });

  test('captures heading and paragraph text for § 541.600', () => {
    // Act
    const sections = parseEcfrXml(xml, OPTIONS);
    const section = sections.find((s) => s.citation === '29 CFR § 541.600');

    // Assert
    expect(section?.heading).toBe('§ 541.600 Amount of salary required.');
    expect(section?.paragraphs).toHaveLength(3);
    expect(section?.paragraphs[0]).toContain('$684 per week');
  });

  test('throws EcfrParseError on input with no section blocks', () => {
    // Act / Assert
    expect(() => parseEcfrXml('<ECFR></ECFR>', OPTIONS)).toThrow(EcfrParseError);
  });

  test('throws EcfrParseError when a section is missing its HEAD', () => {
    // Arrange
    const broken = '<DIV8 N="§ 541.600" TYPE="SECTION"><P>Text only.</P></DIV8>';

    // Act / Assert
    expect(() => parseEcfrXml(broken, OPTIONS)).toThrow(/no HEAD element/);
  });

  test('throws EcfrParseError when a section has no paragraphs (boundary validation)', () => {
    // Arrange
    const broken = '<DIV8 N="§ 541.600" TYPE="SECTION"><HEAD>§ 541.600 Head.</HEAD></DIV8>';

    // Act / Assert
    expect(() => parseEcfrXml(broken, OPTIONS)).toThrow(/boundary validation/);
  });
});
