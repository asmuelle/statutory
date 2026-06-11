import { matchProfiles, topicForCitation } from '@statutory/core';

import type {
  ModelSet,
  SynthesisDraft,
  SynthesisModel,
  SynthesisRequest,
  TriageModel,
  TriageRequest,
  TriageResult,
} from './types.js';

/**
 * Deterministic mock models. The triage mock applies the same taxonomy the
 * cheap model would be prompted with; the synthesis mock writes its delta
 * exclusively from pipeline inputs and quotes spans verbatim from stored
 * version text — same input, same output, every run. No network, ever.
 */

const MAX_QUOTE_LENGTH = 240;

export const createMockTriageModel = (): TriageModel => {
  let calls = 0;
  return {
    name: 'mock-triage (deterministic taxonomy classifier)',
    get callCount() {
      return calls;
    },
    triage(request: TriageRequest): Promise<TriageResult> {
      calls += 1;
      const topic = topicForCitation(request.changeEvent.citation);
      const matched =
        topic === undefined
          ? []
          : matchProfiles(request.jurisdiction, topic.id, request.profiles).map((p) => p.id);
      return Promise.resolve({
        changeEventId: request.changeEvent.id,
        jurisdiction: request.jurisdiction,
        topicId: topic?.id ?? null,
        matchedProfileIds: matched,
      });
    },
  };
};

const buildBody = (request: SynthesisRequest): string => {
  const lines = request.changeEvents.flatMap((event) => [
    `### ${event.citation}`,
    ...event.diff.removedParagraphs.map((p) => `- ~~${p}~~`),
    ...event.diff.addedParagraphs.map((p) => `- **${p}**`),
  ]);
  return [
    `Amended by ${request.frDoc.citation} (${request.frDoc.title}), effective ${request.frDoc.effective_on}.`,
    '',
    '**What changed**',
    ...lines,
  ].join('\n');
};

export const createMockSynthesisModel = (): SynthesisModel => {
  let calls = 0;
  return {
    name: 'mock-synthesis (deterministic delta author)',
    get callCount() {
      return calls;
    },
    synthesize(request: SynthesisRequest): Promise<SynthesisDraft> {
      calls += 1;
      const citations = request.changeEvents.flatMap((event) => {
        const version = request.newVersions.find((v) => v.id === event.newVersionId);
        return event.diff.addedParagraphs.map((paragraph) => ({
          citation: event.citation,
          sectionVersionId: version?.id ?? event.newVersionId,
          quoteSpan: paragraph.slice(0, MAX_QUOTE_LENGTH),
        }));
      });
      const firstCitation = request.changeEvents[0]?.citation ?? request.topicId;
      return Promise.resolve({
        title: `${firstCitation} amended — effective ${request.frDoc.effective_on}`,
        bodyMd: buildBody(request),
        effectiveDate: request.frDoc.effective_on,
        citations,
      });
    },
  };
};

/**
 * Test double for the seeded-mutation suite: corrupts quote spans the way a
 * paraphrasing model would, to prove the gate blocks publication.
 */
export const withQuoteCorruption = (
  model: SynthesisModel,
  corrupt: (quote: string) => string,
): SynthesisModel => ({
  name: `${model.name} + quote corruption`,
  get callCount() {
    return model.callCount;
  },
  async synthesize(request: SynthesisRequest): Promise<SynthesisDraft> {
    const draft = await model.synthesize(request);
    return {
      ...draft,
      citations: draft.citations.map((c) => ({ ...c, quoteSpan: corrupt(c.quoteSpan) })),
    };
  },
});

/** Test double that claims a wrong effective date (invariant 3 mutation). */
export const withEffectiveDateOverride = (
  model: SynthesisModel,
  effectiveDate: string,
): SynthesisModel => ({
  name: `${model.name} + skewed effective date`,
  get callCount() {
    return model.callCount;
  },
  async synthesize(request: SynthesisRequest): Promise<SynthesisDraft> {
    const draft = await model.synthesize(request);
    return { ...draft, effectiveDate };
  },
});

/**
 * Model factory. M1 always returns the deterministic mocks — real Anthropic
 * adapters land post-M1 behind these same interfaces. The key is read from
 * env only to report intent; it is never sent anywhere.
 */
export const createModelsFromEnv = (env: NodeJS.ProcessEnv = process.env): ModelSet => {
  const hasKey = (env['ANTHROPIC_API_KEY'] ?? '').length > 0;
  return {
    triage: createMockTriageModel(),
    synthesis: createMockSynthesisModel(),
    mode: 'mock',
    reason: hasKey
      ? 'ANTHROPIC_API_KEY is set, but real adapters land post-M1; using deterministic mocks.'
      : 'No ANTHROPIC_API_KEY; using deterministic mocks.',
  };
};
