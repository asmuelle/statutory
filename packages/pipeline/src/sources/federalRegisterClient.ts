import { z } from 'zod';

import { POLITE_USER_AGENT } from './ecfrClient.js';
import { federalRegisterDocSchema } from './federalRegister.js';
import type { FederalRegisterDoc } from './federalRegister.js';

/**
 * Live Federal Register API client (keyless, public). One endpoint: the
 * documents search (`/api/v1/documents.json`), agency/date filtered with a
 * tiny `per_page`. The live wire shape (agencies as objects, CFR parts as
 * strings, nullable abstract/dates) is validated with its own zod schema,
 * then mapped into the EXISTING FederalRegisterDoc model; documents that
 * cannot satisfy the strict model are reported as skipped with reasons —
 * never silently dropped.
 */

export const FEDERAL_REGISTER_API_BASE = 'https://www.federalregister.gov';

const MAX_PER_PAGE = 20;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class FederalRegisterClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FederalRegisterClientError';
  }
}

const liveAgencySchema = z.object({ name: z.string().min(1) }).passthrough();

const liveCfrReferenceSchema = z
  .object({
    title: z.number().int(),
    part: z.union([z.string(), z.number(), z.null()]),
  })
  .passthrough();

const liveDocumentSchema = z
  .object({
    document_number: z.string().min(1),
    title: z.string().min(1),
    type: z.string().min(1),
    agencies: z.array(liveAgencySchema),
    publication_date: z.string().regex(ISO_DATE),
    effective_on: z.string().regex(ISO_DATE).nullable().optional(),
    citation: z.string().nullable().optional(),
    cfr_references: z.array(liveCfrReferenceSchema).nullable().optional(),
    html_url: z.string().url(),
    abstract: z.string().nullable().optional(),
    dates: z.string().nullable().optional(),
  })
  .passthrough();

const liveResponseSchema = z
  .object({
    count: z.number().int().nonnegative(),
    results: z.array(liveDocumentSchema).optional(),
  })
  .passthrough();

export type FederalRegisterLiveDocument = z.infer<typeof liveDocumentSchema>;

export interface SkippedDocument {
  readonly documentNumber: string;
  readonly reason: string;
}

export interface FederalRegisterSearchResult {
  /** Total matches reported by the API (not just this page). */
  readonly count: number;
  /** Documents that mapped cleanly into the strict FederalRegisterDoc model. */
  readonly docs: readonly FederalRegisterDoc[];
  /** Documents on this page that failed strict mapping, with reasons. */
  readonly skipped: readonly SkippedDocument[];
}

/** Map one live API document into the strict model used by the pipeline. */
export const mapLiveDocument = (
  live: FederalRegisterLiveDocument,
): { readonly doc: FederalRegisterDoc } | { readonly skip: SkippedDocument } => {
  const bodyExcerpt = [live.dates ?? '', live.abstract ?? ''].filter((s) => s.length > 0).join(' ');
  const candidate = {
    document_number: live.document_number,
    title: live.title,
    type: live.type,
    agencies: live.agencies.map((a) => a.name),
    publication_date: live.publication_date,
    effective_on: live.effective_on ?? '',
    citation: live.citation ?? '',
    cfr_references: (live.cfr_references ?? []).flatMap((ref) => {
      const part = typeof ref.part === 'string' ? Number.parseInt(ref.part, 10) : ref.part;
      return part === null || Number.isNaN(part) ? [] : [{ title: ref.title, part }];
    }),
    html_url: live.html_url,
    body_excerpt: bodyExcerpt,
  };
  const result = federalRegisterDocSchema.safeParse(candidate);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { skip: { documentNumber: live.document_number, reason: issues.slice(0, 300) } };
  }
  return { doc: result.data };
};

export interface FederalRegisterQuery {
  /** Agency slug, e.g. 'wage-and-hour-division'. */
  readonly agencySlug: string;
  /** Document type filter; defaults to final rules only. */
  readonly type?: 'RULE' | 'PRORULE' | 'NOTICE';
  readonly publicationDateGte: string;
  readonly publicationDateLte: string;
  /** Page size; clamped to a polite maximum of 20. */
  readonly perPage?: number;
}

export interface FederalRegisterClientConfig {
  readonly fetchImpl?: typeof fetch;
  readonly apiBase?: string;
  readonly userAgent?: string;
}

export interface FederalRegisterClient {
  searchDocuments(query: FederalRegisterQuery): Promise<FederalRegisterSearchResult>;
}

const DOCUMENT_FIELDS = [
  'document_number',
  'title',
  'type',
  'agencies',
  'publication_date',
  'effective_on',
  'citation',
  'cfr_references',
  'html_url',
  'abstract',
  'dates',
] as const;

export const buildDocumentsSearchPath = (query: FederalRegisterQuery): string => {
  if (!ISO_DATE.test(query.publicationDateGte) || !ISO_DATE.test(query.publicationDateLte)) {
    throw new FederalRegisterClientError('Publication date filters must be YYYY-MM-DD.');
  }
  if (query.agencySlug.length === 0) {
    throw new FederalRegisterClientError('An agency slug filter is required (tiny queries only).');
  }
  const params = new URLSearchParams();
  params.append('conditions[agencies][]', query.agencySlug);
  params.append('conditions[type][]', query.type ?? 'RULE');
  params.append('conditions[publication_date][gte]', query.publicationDateGte);
  params.append('conditions[publication_date][lte]', query.publicationDateLte);
  for (const field of DOCUMENT_FIELDS) {
    params.append('fields[]', field);
  }
  const perPage = Math.min(Math.max(query.perPage ?? 5, 1), MAX_PER_PAGE);
  params.append('per_page', String(perPage));
  return `/api/v1/documents.json?${params.toString()}`;
};

export const createFederalRegisterClient = (
  config: FederalRegisterClientConfig = {},
): FederalRegisterClient => {
  const fetchImpl = config.fetchImpl ?? fetch;
  const apiBase = config.apiBase ?? FEDERAL_REGISTER_API_BASE;
  const userAgent = config.userAgent ?? POLITE_USER_AGENT;

  return {
    searchDocuments: async (query) => {
      const path = buildDocumentsSearchPath(query);
      let response: Response;
      try {
        response = await fetchImpl(`${apiBase}${path}`, {
          headers: { 'User-Agent': userAgent, Accept: 'application/json' },
        });
      } catch (cause) {
        throw new FederalRegisterClientError(
          `Federal Register request failed for ${path}: ${String(cause)}`,
        );
      }
      if (!response.ok) {
        throw new FederalRegisterClientError(
          `Federal Register GET ${path} returned HTTP ${response.status}.`,
        );
      }
      let json: unknown;
      try {
        json = await response.json();
      } catch (cause) {
        throw new FederalRegisterClientError(
          `Federal Register response is not JSON: ${String(cause)}`,
        );
      }
      const parsed = liveResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new FederalRegisterClientError(
          `Federal Register response failed boundary validation: ${parsed.error.message.slice(0, 300)}`,
        );
      }
      const docs: FederalRegisterDoc[] = [];
      const skipped: SkippedDocument[] = [];
      for (const live of parsed.data.results ?? []) {
        const mapped = mapLiveDocument(live);
        if ('doc' in mapped) {
          docs.push(mapped.doc);
        } else {
          skipped.push(mapped.skip);
        }
      }
      return { count: parsed.data.count, docs, skipped };
    },
  };
};
