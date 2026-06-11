import Link from 'next/link';

import { runDolOvertimeScenario } from '@statutory/pipeline';

import { CoverageFooter } from '../components/CoverageFooter';
import { DeltaLedger, ReviewTrail } from '../components/DeltaLedger';
import { FanOut } from '../components/FanOut';
import { PipelineRun } from '../components/PipelineRun';
import { RulebookSection } from '../components/RulebookSection';

/**
 * Read-only render of the M1 vertical slice: the 2024 DOL exempt-salary
 * amendment replayed from archived fixtures through ingest → diff → triage →
 * synthesis (mock) → verification gate → review → publish → fan-out.
 * Fully deterministic; prerendered at build time, no network, no database.
 */
export default async function HomePage() {
  const result = await runDolOvertimeScenario();

  return (
    <div className="page">
      <header className="masthead">
        <h1 className="masthead-brand">Statutory</h1>
        <p className="masthead-tagline">
          A living rulebook, diffed daily against primary sources — every quoted span verified
          before publication.
        </p>
        <p className="masthead-meta">{result.coverageStatement}</p>
        <p className="masthead-kicker">
          <Link href="/onboarding">Set up your rulebook →</Link> ·{' '}
          <Link href="/review">Attorney review queue →</Link>
        </p>
      </header>

      <main>
        <PipelineRun result={result} />
        <DeltaLedger delta={result.publishedDelta} gate={result.gate} />
        <ReviewTrail reviewTrail={result.reviewTrail} />
        <RulebookSection view={result.rulebookSection} />
        <FanOut
          deliveries={result.deliveries}
          profiles={result.profiles}
          emailAlert={result.emailAlert}
        />
      </main>

      <CoverageFooter manifest={result.coverageManifest} />
    </div>
  );
}
