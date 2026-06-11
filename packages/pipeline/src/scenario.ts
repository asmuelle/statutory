import { M1_COVERAGE_MANIFEST, renderCoverageStatement } from '@statutory/core';
import type {
  CanonicalSection,
  CoverageManifest,
  Delivery,
  Delta,
  GateResult,
  PracticeProfile,
  ReviewRecord,
  SectionVersion,
  StructuralDiff,
} from '@statutory/core';

import { renderEmailAlert } from './alerts.js';
import type { EmailAlert } from './alerts.js';
import { defaultFixturesDir, readFixture } from './fixtures.js';
import { createModelsFromEnv } from './llm/mockModels.js';
import {
  crawlSections,
  publishAndFanOut,
  reviewDelta,
  synthesizeDeltas,
  triageChangeEvents,
  verifyDelta,
} from './pipeline.js';
import type { CrawlReport, TriageOutcome } from './pipeline.js';
import { parseEcfrXml } from './sources/ecfr.js';
import { parseFederalRegisterDoc } from './sources/federalRegister.js';
import type { FederalRegisterDoc } from './sources/federalRegister.js';
import { createMemoryStore } from './store.js';
import type { MemoryStore } from './store.js';

/**
 * The M1 acceptance scenario: replay the 2024 DOL exempt-salary-threshold
 * amendment (89 FR 32842) from archived fixtures through the full pipeline.
 * Deterministic end to end — fixed clock, mock models, no network.
 */

const ECFR_SOURCE_URL = 'https://www.ecfr.gov/current/title-29/subtitle-B/chapter-V';
const T_BASELINE = '2024-04-01T06:00:00Z';
const T_RECRAWL = '2024-04-02T06:00:00Z';
const T_AMENDMENT = '2024-07-01T06:00:00Z';
const T_GATE = '2024-07-01T06:05:00Z';
const T_REVIEW = '2024-07-01T14:30:00Z';
const T_PUBLISH = '2024-07-01T14:31:00Z';

export const DEMO_PROFILES: readonly PracticeProfile[] = [
  {
    id: 'profile-demo-ca',
    name: 'Maren Voss — CA employment lawyer (solo)',
    jurisdictions: ['us-federal', 'us-ca'],
    practiceAreas: ['employment'],
    clientTypes: ['small-business', 'startups'],
  },
  {
    id: 'profile-demo-ny',
    name: 'Dale Okafor — NY HR consultant',
    jurisdictions: ['us-federal', 'us-ny'],
    practiceAreas: ['employment'],
    clientTypes: ['mid-market'],
  },
  {
    id: 'profile-demo-fl',
    name: 'Rita Calloway — FL tax CPA',
    jurisdictions: ['us-federal', 'us-fl'],
    practiceAreas: ['tax'],
    clientTypes: ['s-corps'],
  },
];

export interface RulebookSectionView {
  readonly section: CanonicalSection;
  readonly versions: readonly SectionVersion[];
  readonly currentVersion: SectionVersion;
  readonly redline: StructuralDiff;
}

export interface ScenarioResult {
  /** The seeded store, exposed for surfaces that scope per profile (M3). */
  readonly store: MemoryStore;
  readonly profiles: readonly PracticeProfile[];
  readonly baselineReport: CrawlReport;
  readonly recrawlReport: CrawlReport;
  readonly recrawlLlmCalls: number;
  readonly amendmentReport: CrawlReport;
  readonly triageOutcomes: readonly TriageOutcome[];
  readonly frDoc: FederalRegisterDoc;
  readonly gate: GateResult;
  readonly publishedDelta: Delta;
  readonly reviewTrail: readonly ReviewRecord[];
  readonly deliveries: readonly Delivery[];
  readonly emailAlert: EmailAlert;
  readonly rulebookSection: RulebookSectionView;
  readonly coverageManifest: CoverageManifest;
  readonly coverageStatement: string;
  readonly modelUsage: {
    readonly triageCalls: number;
    readonly synthesisCalls: number;
    readonly mode: string;
    readonly reason: string;
  };
}

export const runDolOvertimeScenario = async (options?: {
  readonly fixturesDir?: string;
}): Promise<ScenarioResult> => {
  const fixturesDir = options?.fixturesDir ?? defaultFixturesDir();
  const store = createMemoryStore();
  const models = createModelsFromEnv();

  const baselineXml = readFixture(fixturesDir, 'ecfr/title29-chapterV-2024-04-01.xml');
  const amendmentXml = readFixture(fixturesDir, 'ecfr/title29-chapterV-2024-07-01.xml');
  const frDoc = parseFederalRegisterDoc(
    readFixture(fixturesDir, 'federal-register/2024-08038.json'),
  );

  const parseOptions = { cfrTitle: 29, sourceUrl: ECFR_SOURCE_URL };
  const baselineSections = parseEcfrXml(baselineXml, parseOptions);
  const amendmentSections = parseEcfrXml(amendmentXml, parseOptions);

  // 1. Seed the canonical rulebook from the pre-amendment snapshot.
  const baselineReport = crawlSections(store, baselineSections, {
    jurisdiction: 'us-federal',
    retrievedAt: T_BASELINE,
  });

  // 2. Unchanged re-crawl: must produce zero events and zero LLM calls.
  const recrawlReport = crawlSections(store, baselineSections, {
    jurisdiction: 'us-federal',
    retrievedAt: T_RECRAWL,
  });
  const recrawlLlmCalls = models.triage.callCount + models.synthesis.callCount;

  // 3. The July 1, 2024 snapshot lands: § 541.600 was amended.
  const amendmentReport = crawlSections(store, amendmentSections, {
    jurisdiction: 'us-federal',
    retrievedAt: T_AMENDMENT,
  });

  // 4. Cheap-model triage maps the change to topic x profiles.
  const triageOutcomes = await triageChangeEvents(
    store,
    amendmentReport.changeEvents,
    models.triage,
    'us-federal',
    DEMO_PROFILES,
  );

  // 5. Frontier-model synthesis: ONE delta for the jurisdiction-topic.
  const synthesized = await synthesizeDeltas(store, triageOutcomes, models.synthesis, frDoc);
  const first = synthesized[0];
  if (first === undefined) {
    throw new Error('Scenario invariant broken: no delta synthesized from the amendment.');
  }

  // 6. Deterministic verification gate, then attorney review, then publish.
  const gate = verifyDelta(store, first.deltaId, frDoc, T_GATE);
  reviewDelta(store, {
    deltaId: first.deltaId,
    reviewerId: 'reviewer-demo-attorney',
    status: 'approved',
    notes: 'Citations verified against eCFR snapshot; effective dates correct.',
    decidedAt: T_REVIEW,
  });
  const { delta: publishedDelta, deliveries } = publishAndFanOut(
    store,
    first.deltaId,
    DEMO_PROFILES,
    T_PUBLISH,
  );

  const caProfile = DEMO_PROFILES[0];
  if (caProfile === undefined) {
    throw new Error('Demo profiles missing.');
  }
  const emailAlert = renderEmailAlert(publishedDelta, M1_COVERAGE_MANIFEST, caProfile);

  // Rulebook view of the amended section with full version history.
  const section = store.getSectionByCitation('29 CFR § 541.600');
  if (section === undefined) {
    throw new Error('Scenario invariant broken: § 541.600 missing from rulebook.');
  }
  const versions = store.listVersionsForSection(section.id);
  const currentVersion = store.getVersion(section.currentVersionId);
  const changeEvent = amendmentReport.changeEvents[0];
  if (currentVersion === undefined || changeEvent === undefined) {
    throw new Error('Scenario invariant broken: missing version or change event.');
  }

  return {
    store,
    profiles: DEMO_PROFILES,
    baselineReport,
    recrawlReport,
    recrawlLlmCalls,
    amendmentReport,
    triageOutcomes,
    frDoc,
    gate,
    publishedDelta,
    reviewTrail: store.reviewTrail(first.deltaId),
    deliveries,
    emailAlert,
    rulebookSection: {
      section,
      versions,
      currentVersion,
      redline: changeEvent.diff,
    },
    coverageManifest: M1_COVERAGE_MANIFEST,
    coverageStatement: renderCoverageStatement(M1_COVERAGE_MANIFEST),
    modelUsage: {
      triageCalls: models.triage.callCount,
      synthesisCalls: models.synthesis.callCount,
      mode: models.mode,
      reason: models.reason,
    },
  };
};
