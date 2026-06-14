import { describe, expect, test } from 'vitest';

import { EcfrParseError } from './ecfr.js';
import {
  EcfrClientError,
  countStructureNodes,
  createEcfrClient,
  findStructureNode,
} from './ecfrClient.js';

/** Live Versioner shape: DIV8 with extra attributes and inline markup. */
const LIVE_SECTION_XML = `<?xml version="1.0" encoding="UTF-8"?>
<DIV8 N="541.600" TYPE="SECTION" hierarchy_metadata="{&quot;citation&quot;:&quot;29 CFR 541.600&quot;}">
<HEAD>§ 541.600 Amount of salary required.</HEAD>
<P>(a) <I>Standard salary level.</I> To qualify as an exempt executive, an employee must be compensated on a salary basis.</P>
<P>(1) Beginning on July 1, 2024, $844 per week.</P>
<CITA TYPE="N">[89 FR 32971, Apr. 26, 2024]</CITA>
</DIV8>`;

const STRUCTURE_JSON = JSON.stringify({
  identifier: '29',
  label: 'Title 29—Labor',
  type: 'title',
  children: [
    {
      identifier: '541',
      label: 'Part 541—Exemptions',
      type: 'part',
      children: [
        { identifier: '541.600', label: '§ 541.600 Amount of salary required.', type: 'section' },
        {
          identifier: '541.602',
          label: '§ 541.602 Salary basis.',
          type: 'section',
          children: null,
        },
      ],
    },
  ],
});

interface RecordedRequest {
  readonly url: string;
  readonly userAgent: string | undefined;
}

const stubFetch = (
  status: number,
  body: string,
): { readonly fetchImpl: typeof fetch; readonly requests: RecordedRequest[] } => {
  const requests: RecordedRequest[] = [];
  const fetchImpl = ((url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    requests.push({ url: String(url), userAgent: headers.get('User-Agent') ?? undefined });
    return Promise.resolve(new Response(body, { status }));
  }) as typeof fetch;
  return { fetchImpl, requests };
};

describe('createEcfrClient.fetchTitleStructure', () => {
  test('parses and validates a structure tree', async () => {
    // Arrange
    const { fetchImpl, requests } = stubFetch(200, STRUCTURE_JSON);
    const client = createEcfrClient({ fetchImpl, apiBase: 'https://stub.test' });

    // Act
    const root = await client.fetchTitleStructure('2024-08-01', 29);

    // Assert
    expect(root.identifier).toBe('29');
    expect(requests[0]?.url).toBe(
      'https://stub.test/api/versioner/v1/structure/2024-08-01/title-29.json',
    );
    expect(requests[0]?.userAgent).toMatch(/statutory-pipeline/);
    expect(findStructureNode(root, 'section', '541.600')?.label).toMatch(/Amount of salary/);
    expect(countStructureNodes(root, 'section')).toBe(2);
  });

  test('rejects malformed JSON at the boundary', async () => {
    // Arrange
    const { fetchImpl } = stubFetch(200, 'this is not json');
    const client = createEcfrClient({ fetchImpl });

    // Act + Assert
    await expect(client.fetchTitleStructure('2024-08-01', 29)).rejects.toThrow(EcfrClientError);
  });

  test('rejects schema-invalid structure payloads', async () => {
    // Arrange — node without identifier/label
    const { fetchImpl } = stubFetch(200, JSON.stringify({ type: 'title' }));
    const client = createEcfrClient({ fetchImpl });

    // Act + Assert
    await expect(client.fetchTitleStructure('2024-08-01', 29)).rejects.toThrow(
      /boundary validation/,
    );
  });

  test('surfaces HTTP errors with the status code', async () => {
    // Arrange
    const { fetchImpl } = stubFetch(503, 'unavailable');
    const client = createEcfrClient({ fetchImpl });

    // Act + Assert
    await expect(client.fetchTitleStructure('2024-08-01', 29)).rejects.toThrow(/HTTP 503/);
  });

  test('rejects malformed dates before any request is made', async () => {
    // Arrange
    const { fetchImpl, requests } = stubFetch(200, STRUCTURE_JSON);
    const client = createEcfrClient({ fetchImpl });

    // Act + Assert
    await expect(client.fetchTitleStructure('08/01/2024', 29)).rejects.toThrow(/YYYY-MM-DD/);
    expect(requests).toHaveLength(0);
  });
});

describe('createEcfrClient.fetchSection', () => {
  test('parses live Versioner XML (extra attributes, inline markup) into the model', async () => {
    // Arrange
    const { fetchImpl, requests } = stubFetch(200, LIVE_SECTION_XML);
    const client = createEcfrClient({ fetchImpl, apiBase: 'https://stub.test' });

    // Act
    const sections = await client.fetchSection({
      date: '2024-08-01',
      title: 29,
      part: 541,
      section: '541.600',
    });

    // Assert
    expect(requests[0]?.url).toBe(
      'https://stub.test/api/versioner/v1/full/2024-08-01/title-29.xml?part=541&section=541.600',
    );
    const section = sections[0];
    expect(section?.citation).toBe('29 CFR § 541.600');
    expect(section?.heading).toBe('§ 541.600 Amount of salary required.');
    // Inline <I> markup is stripped; text is preserved verbatim.
    expect(section?.paragraphs[0]).toContain('Standard salary level.');
    expect(section?.paragraphs[0]).not.toContain('<I>');
    expect(section?.paragraphs[1]).toContain('$844 per week');
  });

  test('rejects payloads with no DIV8 SECTION blocks via the parser boundary', async () => {
    // Arrange
    const { fetchImpl } = stubFetch(200, '<HTML>maintenance page</HTML>');
    const client = createEcfrClient({ fetchImpl });

    // Act + Assert
    await expect(
      client.fetchSection({ date: '2024-08-01', title: 29, part: 541, section: '541.600' }),
    ).rejects.toThrow(EcfrParseError);
  });

  test('surfaces network failures as typed client errors', async () => {
    // Arrange
    const fetchImpl = (() => Promise.reject(new Error('socket hang up'))) as typeof fetch;
    const client = createEcfrClient({ fetchImpl });

    // Act + Assert
    await expect(
      client.fetchSection({ date: '2024-08-01', title: 29, part: 541, section: '541.600' }),
    ).rejects.toThrow(EcfrClientError);
  });
});
