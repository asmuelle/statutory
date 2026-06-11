import type { PracticeProfile } from '@statutory/core';

import { defaultFixturesDir, readFixture } from './fixtures.js';
import {
  createMockSynthesisModel,
  createMockTriageModel,
  withQuoteCorruption,
} from './llm/mockModels.js';
import { crawlSections, synthesizeDeltas, triageChangeEvents, verifyDelta } from './pipeline.js';
import { parseEcfrXml } from './sources/ecfr.js';
import { parseFederalRegisterDoc } from './sources/federalRegister.js';
import type { FederalRegisterDoc } from './sources/federalRegister.js';
import { createMemoryStore } from './store.js';
import type { MemoryStore } from './store.js';
import { DEMO_PROFILES } from './scenario.js';

/**
 * Seeds a working review queue for the interactive M2 surface (and e2e):
 * the 2024 DOL amendment replayed from fixtures into TWO drafts —
 *  - one honest synthesis that passed the gate and awaits attorney review;
 *  - one seeded-mutation synthesis ($844 -> $884) that the gate blocked.
 * Deterministic: fixed clock, mock models, no network, no database.
 */

const ECFR_SOURCE_URL = 'https://www.ecfr.gov/current/title-29/subtitle-B/chapter-V';
const T_BASELINE = '2024-04-01T06:00:00Z';
const T_AMENDMENT = '2024-07-01T06:00:00Z';
const T_GATE = '2024-07-01T06:05:00Z';

export interface ReviewQueueFixture {
  readonly store: MemoryStore;
  readonly frDoc: FederalRegisterDoc;
  readonly profiles: readonly PracticeProfile[];
  /** Gate-passed delta awaiting human review. */
  readonly pendingDeltaId: string;
  /** Seeded-mutation delta the deterministic gate blocked. */
  readonly blockedDeltaId: string;
}

export const createReviewQueueFixture = async (options?: {
  readonly fixturesDir?: string;
}): Promise<ReviewQueueFixture> => {
  const fixturesDir = options?.fixturesDir ?? defaultFixturesDir();
  const store = createMemoryStore();
  const frDoc = parseFederalRegisterDoc(
    readFixture(fixturesDir, 'federal-register/2024-08038.json'),
  );

  const parseOptions = { cfrTitle: 29, sourceUrl: ECFR_SOURCE_URL };
  crawlSections(store, parseEcfrXml(readFixture(fixturesDir, 'ecfr/title29-chapterV-2024-04-01.xml'), parseOptions), {
    jurisdiction: 'us-federal',
    retrievedAt: T_BASELINE,
  });
  const amendment = crawlSections(
    store,
    parseEcfrXml(readFixture(fixturesDir, 'ecfr/title29-chapterV-2024-07-01.xml'), parseOptions),
    { jurisdiction: 'us-federal', retrievedAt: T_AMENDMENT },
  );

  const outcomes = await triageChangeEvents(
    store,
    amendment.changeEvents,
    createMockTriageModel(),
    'us-federal',
    DEMO_PROFILES,
  );

  const [honest] = await synthesizeDeltas(store, outcomes, createMockSynthesisModel(), frDoc);
  const [mutated] = await synthesizeDeltas(
    store,
    outcomes,
    withQuoteCorruption(createMockSynthesisModel(), (quote) => quote.replace('$844', '$884')),
    frDoc,
  );
  if (honest === undefined || mutated === undefined) {
    throw new Error('Review queue fixture invariant broken: synthesis produced no delta.');
  }

  verifyDelta(store, honest.deltaId, frDoc, T_GATE);
  verifyDelta(store, mutated.deltaId, frDoc, T_GATE);

  return {
    store,
    frDoc,
    profiles: DEMO_PROFILES,
    pendingDeltaId: honest.deltaId,
    blockedDeltaId: mutated.deltaId,
  };
};
