import { z } from 'zod';

import { TOPICS, matchProfiles } from '@statutory/core';
import type { TopicId } from '@statutory/core';

import type {
  SynthesisDraft,
  SynthesisModel,
  SynthesisRequest,
  TriageModel,
  TriageRequest,
  TriageResult,
} from './types.js';

/**
 * Real Anthropic Messages API adapters behind the existing TriageModel +
 * SynthesisModel seams. Forced tool-use yields machine-checkable output;
 * everything the model returns is validated at the zod boundary and then
 * STILL passes through the deterministic verification gate — the adapter has
 * no authority to publish anything (invariants 2-4). Refusals and missing
 * tool calls raise AnthropicRefusalError so callers drop the event to
 * dead-letter; malformed output raises AnthropicAdapterError. Retries with
 * exponential backoff on 429/5xx/network errors. The API key comes from
 * config (env-gated by the factory), is sent only as the x-api-key header,
 * and never appears in error messages.
 */

export const ANTHROPIC_API_BASE = 'https://api.anthropic.com';
export const DEFAULT_TRIAGE_MODEL = 'claude-3-5-haiku-latest';
export const DEFAULT_SYNTHESIS_MODEL = 'claude-sonnet-4-0';

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;
const TRIAGE_MAX_TOKENS = 1024;
const SYNTHESIS_MAX_TOKENS = 4096;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);

export class AnthropicAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnthropicAdapterError';
  }
}

/** The model declined or did not produce the required tool call — the event
 *  is dropped (dead-letter), never synthesized around. */
export class AnthropicRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnthropicRefusalError';
  }
}

export interface AnthropicConfig {
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
  readonly apiBase?: string;
  readonly triageModel?: string;
  readonly synthesisModel?: string;
  readonly maxRetries?: number;
  /** Injectable for tests; defaults to a real timer sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const toolUseBlockSchema = z
  .object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.unknown() })
  .passthrough();

const contentBlockSchema = z.union([
  toolUseBlockSchema,
  z.object({ type: z.string() }).passthrough(),
]);

const messagesResponseSchema = z
  .object({
    content: z.array(contentBlockSchema),
    stop_reason: z.string().nullable().optional(),
  })
  .passthrough();

type MessagesResponse = z.infer<typeof messagesResponseSchema>;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const retryDelayMs = (attempt: number, retryAfterHeader: string | null): number => {
  const retryAfterSeconds = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1_000;
  }
  return BASE_BACKOFF_MS * 2 ** attempt;
};

interface MessagesRequestBody {
  readonly model: string;
  readonly max_tokens: number;
  readonly temperature: number;
  readonly system: string;
  readonly messages: readonly { readonly role: 'user'; readonly content: string }[];
  readonly tools: readonly {
    readonly name: string;
    readonly description: string;
    readonly input_schema: Readonly<Record<string, unknown>>;
  }[];
  readonly tool_choice: { readonly type: 'tool'; readonly name: string };
}

const createMessagesCaller = (config: AnthropicConfig) => {
  if (config.apiKey.length === 0) {
    throw new AnthropicAdapterError('Anthropic adapter requires a non-empty API key.');
  }
  const fetchImpl = config.fetchImpl ?? fetch;
  const apiBase = config.apiBase ?? ANTHROPIC_API_BASE;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const sleep = config.sleep ?? defaultSleep;

  return async (body: MessagesRequestBody): Promise<MessagesResponse> => {
    let lastFailure = 'no attempt made';
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let response: Response;
      try {
        response = await fetchImpl(`${apiBase}/v1/messages`, {
          method: 'POST',
          headers: {
            'x-api-key': config.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        });
      } catch (cause) {
        lastFailure = `network error: ${String(cause)}`;
        if (attempt < maxRetries) {
          await sleep(retryDelayMs(attempt, null));
          continue;
        }
        break;
      }

      if (RETRYABLE_STATUS.has(response.status)) {
        lastFailure = `HTTP ${response.status}`;
        if (attempt < maxRetries) {
          await sleep(retryDelayMs(attempt, response.headers.get('retry-after')));
          continue;
        }
        break;
      }
      if (!response.ok) {
        throw new AnthropicAdapterError(
          `Anthropic Messages API returned HTTP ${response.status} (not retryable).`,
        );
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch (cause) {
        throw new AnthropicAdapterError(`Anthropic response is not JSON: ${String(cause)}`);
      }
      const parsed = messagesResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new AnthropicAdapterError(
          `Anthropic response failed boundary validation: ${parsed.error.message.slice(0, 300)}`,
        );
      }
      if (parsed.data.stop_reason === 'refusal') {
        throw new AnthropicRefusalError('Model refused the request (stop_reason=refusal).');
      }
      return parsed.data;
    }
    throw new AnthropicAdapterError(
      `Anthropic Messages API failed after ${maxRetries + 1} attempts (${lastFailure}).`,
    );
  };
};

const requireToolInput = (response: MessagesResponse, toolName: string): unknown => {
  const block = response.content.find(
    (b): b is z.infer<typeof toolUseBlockSchema> => b.type === 'tool_use' && 'name' in b,
  );
  if (block === undefined || block.name !== toolName) {
    throw new AnthropicRefusalError(
      `Model did not produce the required '${toolName}' tool call — treating as refusal.`,
    );
  }
  return block.input;
};

// ---------------------------------------------------------------------------
// Triage (cheap model): classify a change event against the fixed taxonomy.
// ---------------------------------------------------------------------------

const TOPIC_IDS = TOPICS.map((t) => t.id);

const triageOutputSchema = z.object({
  topic_id: z.string(),
  matched_profile_ids: z.array(z.string()),
});

const TRIAGE_SYSTEM = [
  'You are a regulatory triage classifier for a compliance product.',
  'Classify the detected CFR change into EXACTLY one topic from the provided taxonomy,',
  "or 'none' if it maps to no listed topic. Then list the ids of the practice",
  'profiles that subscribe to that jurisdiction and practice area.',
  'Always answer by calling the classify_change tool. Never invent topic or profile ids.',
].join(' ');

const triagePrompt = (request: TriageRequest): string =>
  JSON.stringify(
    {
      taxonomy: TOPICS.map((t) => ({
        id: t.id,
        label: t.label,
        practiceArea: t.practiceArea,
        cfr: `${t.cfrTitle} CFR parts ${t.cfrParts.join(', ')}`,
      })),
      jurisdiction: request.jurisdiction,
      changeEvent: {
        citation: request.changeEvent.citation,
        removedParagraphs: request.changeEvent.diff.removedParagraphs,
        addedParagraphs: request.changeEvent.diff.addedParagraphs,
      },
      profiles: request.profiles.map((p) => ({
        id: p.id,
        jurisdictions: p.jurisdictions,
        practiceAreas: p.practiceAreas,
      })),
    },
    null,
    2,
  );

export const createAnthropicTriageModel = (config: AnthropicConfig): TriageModel => {
  const callMessages = createMessagesCaller(config);
  const model = config.triageModel ?? DEFAULT_TRIAGE_MODEL;
  let calls = 0;

  return {
    name: `anthropic-triage (${model})`,
    get callCount() {
      return calls;
    },
    async triage(request: TriageRequest): Promise<TriageResult> {
      calls += 1;
      const response = await callMessages({
        model,
        max_tokens: TRIAGE_MAX_TOKENS,
        temperature: 0,
        system: TRIAGE_SYSTEM,
        messages: [{ role: 'user', content: triagePrompt(request) }],
        tools: [
          {
            name: 'classify_change',
            description: 'Report the taxonomy classification for a detected regulatory change.',
            input_schema: {
              type: 'object',
              properties: {
                topic_id: { type: 'string', enum: [...TOPIC_IDS, 'none'] },
                matched_profile_ids: { type: 'array', items: { type: 'string' } },
              },
              required: ['topic_id', 'matched_profile_ids'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'classify_change' },
      });

      const raw = triageOutputSchema.safeParse(requireToolInput(response, 'classify_change'));
      if (!raw.success) {
        throw new AnthropicAdapterError(
          `Triage tool output failed boundary validation: ${raw.error.message.slice(0, 300)}`,
        );
      }
      const topicId = (TOPIC_IDS as readonly string[]).includes(raw.data.topic_id)
        ? (raw.data.topic_id as TopicId)
        : null;
      // The model only CONFIRMS deterministic profile matching; it can drop
      // a match but can never add a profile that is not actually subscribed.
      const deterministic =
        topicId === null
          ? []
          : matchProfiles(request.jurisdiction, topicId, request.profiles).map((p) => p.id);
      const matchedProfileIds = raw.data.matched_profile_ids.filter((id) =>
        deterministic.includes(id),
      );
      return {
        changeEventId: request.changeEvent.id,
        jurisdiction: request.jurisdiction,
        topicId,
        matchedProfileIds,
      };
    },
  };
};

// ---------------------------------------------------------------------------
// Synthesis (frontier model): author ONE delta per jurisdiction-topic.
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const synthesisOutputSchema = z.object({
  title: z.string().min(1),
  body_md: z.string().min(1),
  effective_date: z.string().regex(ISO_DATE),
  citations: z
    .array(
      z.object({
        citation: z.string().min(1),
        section_version_id: z.string().min(1),
        quote_span: z.string().min(1),
      }),
    )
    .min(1),
});

const SYNTHESIS_SYSTEM = [
  'You are drafting a regulatory change delta for practicing professionals.',
  'Write one concise delta for the given jurisdiction-topic change set.',
  'Every quoted span MUST be copied VERBATIM, character for character, from the',
  'provided section version text, and pinned to that version id. The effective',
  'date MUST come from the Federal Register DATES text. Your output is checked',
  'by a deterministic verification gate and human attorneys; any paraphrased',
  'quote or wrong date blocks publication. Always answer by calling draft_delta.',
].join(' ');

const synthesisPrompt = (request: SynthesisRequest): string =>
  JSON.stringify(
    {
      jurisdiction: request.jurisdiction,
      topicId: request.topicId,
      federalRegisterDocument: {
        documentNumber: request.frDoc.document_number,
        title: request.frDoc.title,
        citation: request.frDoc.citation,
        publicationDate: request.frDoc.publication_date,
        effectiveOn: request.frDoc.effective_on,
        datesAndSummary: request.frDoc.body_excerpt,
        url: request.frDoc.html_url,
      },
      changeEvents: request.changeEvents.map((e) => ({
        citation: e.citation,
        removedParagraphs: e.diff.removedParagraphs,
        addedParagraphs: e.diff.addedParagraphs,
        newVersionId: e.newVersionId,
      })),
      sectionVersions: request.newVersions.map((v) => ({
        id: v.id,
        citation: v.citation,
        paragraphs: v.normalizedParagraphs,
      })),
    },
    null,
    2,
  );

export const createAnthropicSynthesisModel = (config: AnthropicConfig): SynthesisModel => {
  const callMessages = createMessagesCaller(config);
  const model = config.synthesisModel ?? DEFAULT_SYNTHESIS_MODEL;
  let calls = 0;

  return {
    name: `anthropic-synthesis (${model})`,
    get callCount() {
      return calls;
    },
    async synthesize(request: SynthesisRequest): Promise<SynthesisDraft> {
      calls += 1;
      const response = await callMessages({
        model,
        max_tokens: SYNTHESIS_MAX_TOKENS,
        temperature: 0,
        system: SYNTHESIS_SYSTEM,
        messages: [{ role: 'user', content: synthesisPrompt(request) }],
        tools: [
          {
            name: 'draft_delta',
            description: 'Submit the drafted regulatory delta with verbatim citations.',
            input_schema: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                body_md: { type: 'string' },
                effective_date: {
                  type: 'string',
                  description: 'ISO date (YYYY-MM-DD) from the DATES text.',
                },
                citations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      citation: { type: 'string' },
                      section_version_id: { type: 'string' },
                      quote_span: { type: 'string' },
                    },
                    required: ['citation', 'section_version_id', 'quote_span'],
                  },
                  minItems: 1,
                },
              },
              required: ['title', 'body_md', 'effective_date', 'citations'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'draft_delta' },
      });

      const raw = synthesisOutputSchema.safeParse(requireToolInput(response, 'draft_delta'));
      if (!raw.success) {
        throw new AnthropicAdapterError(
          `Synthesis tool output failed boundary validation: ${raw.error.message.slice(0, 300)}`,
        );
      }
      return {
        title: raw.data.title,
        bodyMd: raw.data.body_md,
        effectiveDate: raw.data.effective_date,
        citations: raw.data.citations.map((c) => ({
          citation: c.citation,
          sectionVersionId: c.section_version_id,
          quoteSpan: c.quote_span,
        })),
      };
    },
  };
};
