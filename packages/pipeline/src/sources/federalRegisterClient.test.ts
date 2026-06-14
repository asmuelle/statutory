import { describe, expect, test } from 'vitest';

import { extractEffectiveDates } from '@statutory/core';

import {
  FederalRegisterClientError,
  buildDocumentsSearchPath,
  createFederalRegisterClient,
  mapLiveDocument,
} from './federalRegisterClient.js';
import type { FederalRegisterLiveDocument } from './federalRegisterClient.js';

/** Trimmed copy of the real live API entry for 89 FR 32842 (2024-08038). */
const LIVE_DOC: FederalRegisterLiveDocument = {
  document_number: '2024-08038',
  title:
    'Defining and Delimiting the Exemptions for Executive, Administrative, Professional, Outside Sales, and Computer Employees',
  type: 'Rule',
  agencies: [
    { name: 'Labor Department', slug: 'labor-department' },
    { name: 'Wage and Hour Division', slug: 'wage-and-hour-division' },
  ],
  publication_date: '2024-04-26',
  effective_on: '2024-07-01',
  citation: '89 FR 32842',
  cfr_references: [{ chapter: null, part: '541', title: 29 }],
  html_url:
    'https://www.federalregister.gov/documents/2024/04/26/2024-08038/defining-and-delimiting',
  abstract:
    'The Department of Labor is updating and revising the regulations issued under the Fair Labor Standards Act implementing the exemptions from minimum wage and overtime pay requirements.',
  dates: 'This final rule is effective July 1, 2024.',
};

const liveResponse = (results: readonly FederalRegisterLiveDocument[]): string =>
  JSON.stringify({ count: results.length, total_pages: 1, results });

const stubFetch = (
  status: number,
  body: string,
): { readonly fetchImpl: typeof fetch; readonly urls: string[] } => {
  const urls: string[] = [];
  const fetchImpl = ((url: string | URL) => {
    urls.push(String(url));
    return Promise.resolve(
      new Response(body, { status, headers: { 'content-type': 'application/json' } }),
    );
  }) as typeof fetch;
  return { fetchImpl, urls };
};

describe('buildDocumentsSearchPath', () => {
  test('builds an agency/date filtered tiny query', () => {
    // Act
    const path = buildDocumentsSearchPath({
      agencySlug: 'wage-and-hour-division',
      publicationDateGte: '2024-04-20',
      publicationDateLte: '2024-04-30',
    });

    // Assert
    expect(path).toContain('conditions%5Bagencies%5D%5B%5D=wage-and-hour-division');
    expect(path).toContain('conditions%5Btype%5D%5B%5D=RULE');
    expect(path).toContain('per_page=5');
    expect(path).toContain('fields%5B%5D=dates');
  });

  test('clamps per_page to a polite maximum', () => {
    // Act
    const path = buildDocumentsSearchPath({
      agencySlug: 'wage-and-hour-division',
      publicationDateGte: '2024-04-20',
      publicationDateLte: '2024-04-30',
      perPage: 500,
    });

    // Assert
    expect(path).toContain('per_page=20');
  });

  test('rejects malformed dates and missing agency filters', () => {
    // Act + Assert
    expect(() =>
      buildDocumentsSearchPath({
        agencySlug: 'wage-and-hour-division',
        publicationDateGte: '04/20/2024',
        publicationDateLte: '2024-04-30',
      }),
    ).toThrow(FederalRegisterClientError);
    expect(() =>
      buildDocumentsSearchPath({
        agencySlug: '',
        publicationDateGte: '2024-04-20',
        publicationDateLte: '2024-04-30',
      }),
    ).toThrow(/agency slug/);
  });
});

describe('mapLiveDocument', () => {
  test('maps the live wire shape into the strict FederalRegisterDoc model', () => {
    // Act
    const mapped = mapLiveDocument(LIVE_DOC);

    // Assert
    if (!('doc' in mapped)) {
      throw new Error(`Expected mapped doc, got skip: ${mapped.skip.reason}`);
    }
    expect(mapped.doc.agencies).toEqual(['Labor Department', 'Wage and Hour Division']);
    expect(mapped.doc.cfr_references).toEqual([{ title: 29, part: 541 }]);
    expect(mapped.doc.effective_on).toBe('2024-07-01');
    // The DATES text feeds the deterministic effective-date cross-check.
    expect(extractEffectiveDates(mapped.doc.body_excerpt)).toContain('2024-07-01');
  });

  test('skips documents without an effective date, with a reason', () => {
    // Arrange
    const noEffective = { ...LIVE_DOC, effective_on: null };

    // Act
    const mapped = mapLiveDocument(noEffective);

    // Assert
    expect('skip' in mapped && mapped.skip.reason).toMatch(/effective_on/);
  });

  test('skips documents whose abstract+dates are too thin to gate against', () => {
    // Arrange
    const thin = { ...LIVE_DOC, abstract: null, dates: 'Short.' };

    // Act
    const mapped = mapLiveDocument(thin);

    // Assert
    expect('skip' in mapped && mapped.skip.reason).toMatch(/body_excerpt/);
  });
});

describe('createFederalRegisterClient.searchDocuments', () => {
  test('fetches, validates, and maps a live-shaped response', async () => {
    // Arrange
    const { fetchImpl, urls } = stubFetch(200, liveResponse([LIVE_DOC]));
    const client = createFederalRegisterClient({ fetchImpl, apiBase: 'https://stub.test' });

    // Act
    const result = await client.searchDocuments({
      agencySlug: 'wage-and-hour-division',
      publicationDateGte: '2024-04-20',
      publicationDateLte: '2024-04-30',
    });

    // Assert
    expect(urls[0]).toMatch(/^https:\/\/stub\.test\/api\/v1\/documents\.json\?/);
    expect(result.count).toBe(1);
    expect(result.docs[0]?.document_number).toBe('2024-08038');
    expect(result.skipped).toEqual([]);
  });

  test('reports unmappable documents as skipped instead of dropping them', async () => {
    // Arrange
    const { fetchImpl } = stubFetch(
      200,
      liveResponse([LIVE_DOC, { ...LIVE_DOC, document_number: '2024-99999', effective_on: null }]),
    );
    const client = createFederalRegisterClient({ fetchImpl });

    // Act
    const result = await client.searchDocuments({
      agencySlug: 'wage-and-hour-division',
      publicationDateGte: '2024-04-20',
      publicationDateLte: '2024-04-30',
    });

    // Assert
    expect(result.docs).toHaveLength(1);
    expect(result.skipped).toEqual([
      { documentNumber: '2024-99999', reason: expect.stringMatching(/effective_on/) as string },
    ]);
  });

  test('rejects schema-invalid responses at the boundary', async () => {
    // Arrange
    const { fetchImpl } = stubFetch(200, JSON.stringify({ results: 'nope' }));
    const client = createFederalRegisterClient({ fetchImpl });

    // Act + Assert
    await expect(
      client.searchDocuments({
        agencySlug: 'wage-and-hour-division',
        publicationDateGte: '2024-04-20',
        publicationDateLte: '2024-04-30',
      }),
    ).rejects.toThrow(/boundary validation/);
  });

  test('surfaces HTTP errors with the status code', async () => {
    // Arrange
    const { fetchImpl } = stubFetch(429, 'slow down');
    const client = createFederalRegisterClient({ fetchImpl });

    // Act + Assert
    await expect(
      client.searchDocuments({
        agencySlug: 'wage-and-hour-division',
        publicationDateGte: '2024-04-20',
        publicationDateLte: '2024-04-30',
      }),
    ).rejects.toThrow(/HTTP 429/);
  });
});
