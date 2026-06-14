import { z } from 'zod';

import type { ParsedSection } from '@statutory/core';

import { parseEcfrXml } from './ecfr.js';

/**
 * Live eCFR Versioner API client (keyless, public). Two endpoints only:
 *   - structure: GET /api/versioner/v1/structure/{date}/title-{title}.json
 *   - section XML: GET /api/versioner/v1/full/{date}/title-{title}.xml?part=&section=
 * Every payload is validated at the zod boundary; non-2xx and malformed
 * bodies throw typed errors so callers dead-letter loudly (invariant: no
 * silent skips). Requests identify themselves via User-Agent and callers are
 * expected to keep request counts tiny (TOOLS.md politeness rules).
 */

export const ECFR_API_BASE = 'https://www.ecfr.gov';
export const POLITE_USER_AGENT =
  'statutory-pipeline/0.1 (regulatory change monitoring; contact herban.mueller@gmail.com)';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class EcfrClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EcfrClientError';
  }
}

export interface EcfrStructureNode {
  readonly identifier: string;
  readonly label: string;
  readonly type: string;
  readonly children?: readonly EcfrStructureNode[] | null | undefined;
}

const structureNodeSchema: z.ZodType<EcfrStructureNode> = z.lazy(() =>
  z.object({
    identifier: z.string().min(1),
    label: z.string().min(1),
    type: z.string().min(1),
    children: z.array(structureNodeSchema).readonly().nullable().optional(),
  }),
);

/** Depth-first search of a structure tree for a node by type + identifier. */
export const findStructureNode = (
  node: EcfrStructureNode,
  type: string,
  identifier: string,
): EcfrStructureNode | undefined => {
  if (node.type === type && node.identifier === identifier) {
    return node;
  }
  for (const child of node.children ?? []) {
    const found = findStructureNode(child, type, identifier);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
};

/** Count nodes of a given type in a structure tree (e.g. sections in a title). */
export const countStructureNodes = (node: EcfrStructureNode, type: string): number => {
  const own = node.type === type ? 1 : 0;
  return (node.children ?? []).reduce((sum, child) => sum + countStructureNodes(child, type), own);
};

export interface EcfrClientConfig {
  readonly fetchImpl?: typeof fetch;
  readonly apiBase?: string;
  readonly userAgent?: string;
}

export interface EcfrSectionRequest {
  /** Point-in-time date, e.g. '2024-08-01'. */
  readonly date: string;
  readonly title: number;
  readonly part: number;
  /** Section identifier, e.g. '541.600'. */
  readonly section: string;
}

export interface EcfrClient {
  /** Fetch and validate the structure JSON for one title at one date. */
  fetchTitleStructure(date: string, title: number): Promise<EcfrStructureNode>;
  /** Fetch one section's point-in-time XML and parse it into ParsedSections. */
  fetchSection(request: EcfrSectionRequest): Promise<readonly ParsedSection[]>;
}

const assertIsoDate = (date: string): void => {
  if (!ISO_DATE.test(date)) {
    throw new EcfrClientError(`Invalid point-in-time date '${date}' — expected YYYY-MM-DD.`);
  }
};

export const createEcfrClient = (config: EcfrClientConfig = {}): EcfrClient => {
  const fetchImpl = config.fetchImpl ?? fetch;
  const apiBase = config.apiBase ?? ECFR_API_BASE;
  const userAgent = config.userAgent ?? POLITE_USER_AGENT;

  const get = async (path: string): Promise<string> => {
    let response: Response;
    try {
      response = await fetchImpl(`${apiBase}${path}`, {
        headers: { 'User-Agent': userAgent, Accept: '*/*' },
      });
    } catch (cause) {
      throw new EcfrClientError(`eCFR request failed for ${path}: ${String(cause)}`);
    }
    if (!response.ok) {
      throw new EcfrClientError(`eCFR GET ${path} returned HTTP ${response.status}.`);
    }
    return response.text();
  };

  return {
    fetchTitleStructure: async (date, title) => {
      assertIsoDate(date);
      const body = await get(`/api/versioner/v1/structure/${date}/title-${title}.json`);
      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch (cause) {
        throw new EcfrClientError(`eCFR structure response is not JSON: ${String(cause)}`);
      }
      const parsed = structureNodeSchema.safeParse(json);
      if (!parsed.success) {
        throw new EcfrClientError(
          `eCFR structure failed boundary validation: ${parsed.error.message.slice(0, 300)}`,
        );
      }
      return parsed.data;
    },

    fetchSection: async (request) => {
      assertIsoDate(request.date);
      const path =
        `/api/versioner/v1/full/${request.date}/title-${request.title}.xml` +
        `?part=${request.part}&section=${request.section}`;
      const xml = await get(path);
      const sourceUrl = `${ECFR_API_BASE}${path}`;
      // parseEcfrXml throws EcfrParseError on malformed/empty payloads.
      return parseEcfrXml(xml, { cfrTitle: request.title, sourceUrl });
    },
  };
};
