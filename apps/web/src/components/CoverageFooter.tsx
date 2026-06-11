import { NOT_LEGAL_ADVICE } from '@statutory/core';
import type { CoverageManifest } from '@statutory/core';

interface CoverageFooterProps {
  readonly manifest: CoverageManifest;
}

/**
 * Coverage honesty (invariant 8): the monitored/not-monitored manifest is
 * rendered verbatim on every surface, with the not-legal-advice framing.
 */
export function CoverageFooter({ manifest }: CoverageFooterProps) {
  return (
    <footer className="coverage-footer">
      <h2>Coverage manifest</h2>
      <div className="coverage-columns">
        <div>
          <h3>Monitored</h3>
          <ul>
            <li>Jurisdictions: {manifest.jurisdictions.join(', ')}</li>
            <li>Topics: {manifest.topics.join(', ')}</li>
            {manifest.sources.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>NOT monitored</h3>
          <ul className="not-monitored">
            {manifest.notMonitored.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="legal-framing">{NOT_LEGAL_ADVICE}</p>
    </footer>
  );
}
