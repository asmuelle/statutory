import { z } from 'zod';

import type { ParsedSection } from '@statutory/core';

/**
 * Deterministic parser for the eCFR Versioner XML subset used by the M1
 * fixtures (DIV8 SECTION blocks with HEAD and P children). Pure code, no
 * model anywhere near parsing (invariant 6). Malformed input fails loudly so
 * the pipeline can dead-letter it — never a silent skip.
 */

const SECTION_BLOCK = /<DIV8 N="§ (\d+\.\d+)" TYPE="SECTION">([\s\S]*?)<\/DIV8>/g;
const HEAD_TAG = /<HEAD>([\s\S]*?)<\/HEAD>/;
const PARA_TAG = /<P>([\s\S]*?)<\/P>/g;

const decodeEntities = (text: string): string =>
  text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

const parsedSectionSchema = z.object({
  citation: z.string().regex(/^\d+ CFR § \d+\.\d+$/),
  heading: z.string().min(1),
  paragraphs: z.array(z.string().min(1)).min(1),
  sourceUrl: z.string().url(),
});

export class EcfrParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EcfrParseError';
  }
}

export interface EcfrParseOptions {
  readonly cfrTitle: number;
  readonly sourceUrl: string;
}

/** Parse an eCFR Versioner XML snapshot into sections, validated at the boundary. */
export const parseEcfrXml = (xml: string, options: EcfrParseOptions): readonly ParsedSection[] => {
  const blocks = [...xml.matchAll(SECTION_BLOCK)];
  if (blocks.length === 0) {
    throw new EcfrParseError('No DIV8 SECTION blocks found — wrong format or corrupted snapshot.');
  }

  return blocks.map((block) => {
    const sectionNumber = block[1] ?? '';
    const body = block[2] ?? '';
    const headMatch = HEAD_TAG.exec(body);
    if (headMatch === null) {
      throw new EcfrParseError(`Section ${sectionNumber} has no HEAD element.`);
    }
    const paragraphs = [...body.matchAll(PARA_TAG)].map((m) => decodeEntities(m[1] ?? ''));

    const candidate = {
      citation: `${options.cfrTitle} CFR § ${sectionNumber}`,
      heading: decodeEntities(headMatch[1] ?? '').trim(),
      paragraphs,
      sourceUrl: options.sourceUrl,
    };
    const result = parsedSectionSchema.safeParse(candidate);
    if (!result.success) {
      throw new EcfrParseError(
        `Section ${sectionNumber} failed boundary validation: ${result.error.message}`,
      );
    }
    return result.data;
  });
};
