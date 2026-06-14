import { describe, expect, test } from 'vitest';

import { runVerificationGate } from '@statutory/core';
import type { ChangeEvent, SectionVersion } from '@statutory/core';

import type { FederalRegisterDoc } from '../sources/federalRegister.js';
import {
  AnthropicAdapterError,
  AnthropicRefusalError,
  createAnthropicSynthesisModel,
  createAnthropicTriageModel,
} from './anthropic.js';
import type { SynthesisRequest, TriageRequest } from './types.js';

/**
 * Fetch-stub contract tests for the real Anthropic adapters. No network: a
 * fake fetch returns canned Messages-API responses. These prove request
 * shape, retry/backoff, refusal/boundary handling, that the API key never
 * leaks into errors, and — the load-bearing M4 invariant — that adapter
 * output has NO publication authority: it passes through the SAME
 * deterministic verification gate as any other source, provider-independent.
 */

const API_KEY = 'sk-ant-secret-DO-NOT-LEAK';
const noSleep = async (): Promise<void> => undefined;

const toolUseResponse = (toolName: string, input: unknown, stopReason = 'tool_use'): Response =>
  new Response(
    JSON.stringify({
      content: [{ type: 'tool_use', id: 'block-1', name: toolName, input }],
      stop_reason: stopReason,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

const EVENT: ChangeEvent = {
  id: 'evt-1',
  sectionId: 'sec-541-600',
  citation: '29 CFR § 541.600',
  oldVersionId: 'ver-1',
  newVersionId: 'ver-2',
  detectedAt: '2024-07-01T06:00:00Z',
  diff: { removedParagraphs: ['$684 per week'], addedParagraphs: ['$844 per week'] },
  status: 'detected',
};

const triageRequest: TriageRequest = {
  changeEvent: EVENT,
  jurisdiction: 'us-federal',
  profiles: [],
};

describe('createAnthropicTriageModel — request shape', () => {
  test('forces the classify_change tool and sends auth headers, never on construction', async () => {
    // Arrange
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return toolUseResponse('classify_change', {
        topic_id: 'exempt-status',
        matched_profile_ids: [],
      });
    }) as unknown as typeof fetch;

    const model = createAnthropicTriageModel({ apiKey: API_KEY, fetchImpl, sleep: noSleep });
    expect(captured).toBeNull(); // construction performs no I/O
    expect(model.callCount).toBe(0);

    // Act
    const result = await model.triage(triageRequest);

    // Assert
    expect(model.callCount).toBe(1);
    expect(result.topicId).toBe('exempt-status');
    expect(captured).not.toBeNull();
    const { url, init } = captured as unknown as { url: string; init: RequestInit };
    expect(url).toMatch(/\/v1\/messages$/);
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(API_KEY);
    expect(headers['anthropic-version']).toBeDefined();
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['temperature']).toBe(0);
    expect(body['tool_choice']).toEqual({ type: 'tool', name: 'classify_change' });
  });
});

describe('createAnthropicTriageModel — resilience', () => {
  test('retries on 429 then succeeds', async () => {
    // Arrange
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } });
      }
      return toolUseResponse('classify_change', {
        topic_id: 'exempt-status',
        matched_profile_ids: [],
      });
    }) as unknown as typeof fetch;

    const model = createAnthropicTriageModel({ apiKey: API_KEY, fetchImpl, sleep: noSleep });

    // Act
    const result = await model.triage(triageRequest);

    // Assert
    expect(calls).toBe(2);
    expect(result.topicId).toBe('exempt-status');
  });

  test('a refusal stop_reason raises AnthropicRefusalError', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ content: [], stop_reason: 'refusal' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    const model = createAnthropicTriageModel({ apiKey: API_KEY, fetchImpl, sleep: noSleep });

    await expect(model.triage(triageRequest)).rejects.toBeInstanceOf(AnthropicRefusalError);
  });

  test('a missing tool call is treated as a refusal', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ content: [{ type: 'text', text: 'no tool' }], stop_reason: 'end_turn' }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )) as unknown as typeof fetch;
    const model = createAnthropicTriageModel({ apiKey: API_KEY, fetchImpl, sleep: noSleep });

    await expect(model.triage(triageRequest)).rejects.toBeInstanceOf(AnthropicRefusalError);
  });

  test('malformed tool output fails the zod boundary with AnthropicAdapterError', async () => {
    const fetchImpl = (async () =>
      toolUseResponse('classify_change', { wrong: 'shape' })) as unknown as typeof fetch;
    const model = createAnthropicTriageModel({ apiKey: API_KEY, fetchImpl, sleep: noSleep });

    await expect(model.triage(triageRequest)).rejects.toBeInstanceOf(AnthropicAdapterError);
  });

  test('a non-retryable error never leaks the API key', async () => {
    const fetchImpl = (async () =>
      new Response('bad request', { status: 400 })) as unknown as typeof fetch;
    const model = createAnthropicTriageModel({ apiKey: API_KEY, fetchImpl, sleep: noSleep });

    await expect(model.triage(triageRequest)).rejects.toSatisfy(
      (e: unknown) => e instanceof Error && !e.message.includes(API_KEY),
    );
  });
});

// ---------------------------------------------------------------------------
// Provider independence: adapter output has no publication authority.
// ---------------------------------------------------------------------------

const VERSION_TEXT =
  'An employee employed in a bona fide executive capacity earning $844 per week.';

const NEW_VERSION: SectionVersion = {
  id: 'ver-2',
  sectionId: 'sec-541-600',
  citation: '29 CFR § 541.600',
  normalizedParagraphs: [VERSION_TEXT],
  normalizedText: VERSION_TEXT,
  contentHash: 'hash-ver-2',
  retrievedAt: '2024-07-01T06:00:00Z',
  sourceUrl: 'https://www.ecfr.gov/current/title-29/section-541.600',
  supersedesVersionId: 'ver-1',
};

const FR_DOC: FederalRegisterDoc = {
  document_number: '2024-08249',
  title: 'Defining and Delimiting the Exemptions for Executive Employees',
  type: 'Rule',
  agencies: ['Wage and Hour Division'],
  publication_date: '2024-04-26',
  effective_on: '2024-07-01',
  citation: '89 FR 32842',
  cfr_references: [{ title: 29, part: 541 }],
  html_url: 'https://www.federalregister.gov/documents/2024/04/26/2024-08249/overtime',
  body_excerpt:
    'DATES: This rule is effective July 1, 2024. The standard salary level rises to $844 per week.',
};

const synthesisRequest: SynthesisRequest = {
  jurisdiction: 'us-federal',
  topicId: 'exempt-status',
  changeEvents: [EVENT],
  newVersions: [NEW_VERSION],
  frDoc: FR_DOC,
};

const getVersion = (id: string): SectionVersion | undefined =>
  id === NEW_VERSION.id ? NEW_VERSION : undefined;

const draftResponse = (quoteSpan: string, effectiveDate: string): Response =>
  toolUseResponse('draft_delta', {
    title: 'Salary threshold rises to $844/week',
    body_md: 'The standard salary level changes.',
    effective_date: effectiveDate,
    citations: [
      { citation: '29 CFR § 541.600', section_version_id: 'ver-2', quote_span: quoteSpan },
    ],
  });

describe('Anthropic synthesis output is span-verified by the deterministic gate', () => {
  test('a verbatim quote from the adapter passes the gate', async () => {
    // Arrange — adapter returns a draft quoting the version VERBATIM
    const fetchImpl = (async () =>
      draftResponse(VERSION_TEXT, '2024-07-01')) as unknown as typeof fetch;
    const model = createAnthropicSynthesisModel({ apiKey: API_KEY, fetchImpl, sleep: noSleep });

    // Act
    const draft = await model.synthesize(synthesisRequest);
    const gate = runVerificationGate({
      citations: draft.citations,
      modelEffectiveDate: draft.effectiveDate,
      sourceDateText: FR_DOC.body_excerpt,
      getVersion,
      now: '2024-07-02T00:00:00Z',
    });

    // Assert
    expect(gate.ok).toBe(true);
    expect(gate.verifiedCitations.every((c) => c.verifiedAt !== null)).toBe(true);
  });

  test('a PARAPHRASED quote from the adapter is blocked exactly like any other source', async () => {
    // Arrange — adapter paraphrases (not character-for-character)
    const fetchImpl = (async () =>
      draftResponse(
        'an employee earning eight hundred forty-four dollars',
        '2024-07-01',
      )) as unknown as typeof fetch;
    const model = createAnthropicSynthesisModel({ apiKey: API_KEY, fetchImpl, sleep: noSleep });

    // Act
    const draft = await model.synthesize(synthesisRequest);
    const gate = runVerificationGate({
      citations: draft.citations,
      modelEffectiveDate: draft.effectiveDate,
      sourceDateText: FR_DOC.body_excerpt,
      getVersion,
      now: '2024-07-02T00:00:00Z',
    });

    // Assert — the gate refuses; the adapter cannot publish around it
    expect(gate.ok).toBe(false);
    expect(gate.failures.some((f) => f.kind === 'span_mismatch')).toBe(true);
    expect(gate.verifiedCitations.every((c) => c.verifiedAt === null)).toBe(true);
  });

  test('a wrong effective date from the adapter is blocked by the gate', async () => {
    // Arrange — verbatim quote but a fabricated effective date
    const fetchImpl = (async () =>
      draftResponse(VERSION_TEXT, '2025-01-01')) as unknown as typeof fetch;
    const model = createAnthropicSynthesisModel({ apiKey: API_KEY, fetchImpl, sleep: noSleep });

    // Act
    const draft = await model.synthesize(synthesisRequest);
    const gate = runVerificationGate({
      citations: draft.citations,
      modelEffectiveDate: draft.effectiveDate,
      sourceDateText: FR_DOC.body_excerpt,
      getVersion,
      now: '2024-07-02T00:00:00Z',
    });

    // Assert
    expect(gate.ok).toBe(false);
    expect(gate.failures.some((f) => f.kind === 'effective_date_mismatch')).toBe(true);
  });
});
