import type {
  ChangeEvent,
  Jurisdiction,
  PracticeProfile,
  SectionVersion,
  TopicId,
} from '@statutory/core';

import type { FederalRegisterDoc } from '../sources/federalRegister.js';

/**
 * Model interfaces. Everything LLM-shaped sits behind these protocols with
 * deterministic mock implementations; the MVP builds, tests, and runs with
 * zero AI API calls. Cheap model = triage only; frontier model = synthesis
 * only (invariant 6). Both expose call counters so tests can prove the
 * zero-LLM-on-unchanged invariant (invariant 1).
 */

export interface TriageRequest {
  readonly changeEvent: ChangeEvent;
  readonly jurisdiction: Jurisdiction;
  readonly profiles: readonly PracticeProfile[];
}

export interface TriageResult {
  readonly changeEventId: string;
  readonly jurisdiction: Jurisdiction;
  /** null when the change maps to no monitored topic (event is archived). */
  readonly topicId: TopicId | null;
  readonly matchedProfileIds: readonly string[];
}

export interface TriageModel {
  readonly name: string;
  readonly callCount: number;
  triage(request: TriageRequest): Promise<TriageResult>;
}

export interface SynthesisRequest {
  readonly jurisdiction: Jurisdiction;
  readonly topicId: TopicId;
  readonly changeEvents: readonly ChangeEvent[];
  readonly newVersions: readonly SectionVersion[];
  readonly frDoc: FederalRegisterDoc;
}

export interface DraftCitation {
  readonly citation: string;
  readonly sectionVersionId: string;
  readonly quoteSpan: string;
}

export interface SynthesisDraft {
  readonly title: string;
  readonly bodyMd: string;
  readonly effectiveDate: string;
  readonly citations: readonly DraftCitation[];
}

export interface SynthesisModel {
  readonly name: string;
  readonly callCount: number;
  synthesize(request: SynthesisRequest): Promise<SynthesisDraft>;
}

export interface ModelSet {
  readonly triage: TriageModel;
  readonly synthesis: SynthesisModel;
  readonly mode: 'mock' | 'anthropic';
  readonly reason: string;
}
