import { describe, expect, it } from 'vitest';

import { parseDeltaBody } from './deltaBody.js';

describe('parseDeltaBody', () => {
  it('parses the synthesis markdown subset into typed blocks in order', () => {
    // Arrange — shape produced by the deterministic synthesis model.
    const bodyMd = [
      'Amended by 89 FR 32842, effective 2024-07-01.',
      '',
      '**What changed**',
      '### 29 CFR § 541.600',
      '- ~~old salary level paragraph~~',
      '- **new salary level paragraph**',
    ].join('\n');

    // Act
    const blocks = parseDeltaBody(bodyMd);

    // Assert
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'Amended by 89 FR 32842, effective 2024-07-01.' },
      { kind: 'label', text: 'What changed' },
      { kind: 'heading', text: '29 CFR § 541.600' },
      { kind: 'removal', text: 'old salary level paragraph' },
      { kind: 'addition', text: 'new salary level paragraph' },
    ]);
  });

  it('drops blank and whitespace-only lines', () => {
    // Arrange
    const bodyMd = 'first\n\n   \nsecond';

    // Act
    const blocks = parseDeltaBody(bodyMd);

    // Assert
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'paragraph']);
  });

  it('treats unmatched markup as plain paragraphs (never drops content)', () => {
    // Arrange — partial/unknown markup must not be silently lost.
    const bodyMd = '- a plain list line\n**unterminated bold';

    // Act
    const blocks = parseDeltaBody(bodyMd);

    // Assert
    expect(blocks).toEqual([
      { kind: 'paragraph', text: '- a plain list line' },
      { kind: 'paragraph', text: '**unterminated bold' },
    ]);
  });

  it('is deterministic: same input yields identical output', () => {
    // Arrange
    const bodyMd = '### 29 CFR § 778.101\n- **added text**';

    // Act
    const first = parseDeltaBody(bodyMd);
    const second = parseDeltaBody(bodyMd);

    // Assert
    expect(second).toEqual(first);
  });
});
