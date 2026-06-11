import { topicById } from './taxonomy.js';
import type { CoverageManifest } from './types.js';

/**
 * Coverage honesty (invariant 8): every surface renders monitoring scope from
 * this manifest and never implies broader coverage.
 */

export const NOT_LEGAL_ADVICE =
  'This alert is an information service, not legal advice. Verify every citation against the primary source before relying on it.';

/** The M1 coverage manifest: federal employment slice only. */
export const M1_COVERAGE_MANIFEST: CoverageManifest = {
  jurisdictions: ['us-federal'],
  topics: ['exempt-status', 'overtime', 'hours-worked'],
  sources: ['eCFR Title 29 Parts 541, 778, 785 (Versioner XML)', 'Federal Register API'],
  notMonitored: [
    'State and local ordinances',
    'Case law reinterpreting monitored statutes',
    'Sub-regulatory agency guidance (opinion letters, FAQs)',
  ],
};

/** Render the manifest as a single honest coverage statement. */
export const renderCoverageStatement = (manifest: CoverageManifest): string => {
  const topics = manifest.topics.map((t) => topicById(t).label).join('; ');
  const monitored = `Monitored: ${manifest.jurisdictions.join(', ')} — ${topics}. Sources: ${manifest.sources.join('; ')}.`;
  const not = `NOT monitored: ${manifest.notMonitored.join('; ')}.`;
  return `${monitored} ${not}`;
};
