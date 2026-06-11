import type { ScenarioResult } from '@statutory/pipeline';

interface PipelineRunProps {
  readonly result: ScenarioResult;
}

/**
 * Replay ledger for the M1 acceptance scenario: baseline seed, unchanged
 * re-crawl (invariant 1 made visible: zero events, zero model calls), and
 * the amendment crawl that produced the change event.
 */
export function PipelineRun({ result }: PipelineRunProps) {
  const { baselineReport, recrawlReport, recrawlLlmCalls, amendmentReport, modelUsage } = result;
  return (
    <section className="slice-section" aria-labelledby="pipeline-run-heading">
      <h2 id="pipeline-run-heading">Pipeline replay — archived fixtures, no network</h2>
      <dl className="crawl-ledger">
        <dt>2024-04-01 baseline</dt>
        <dd>
          {baselineReport.seeded} sections seeded from eCFR Title 29 (Parts 541, 778, 785),{' '}
          {baselineReport.changeEvents.length} change events
        </dd>

        <dt>2024-04-02 re-crawl</dt>
        <dd>
          {recrawlReport.unchanged} sections unchanged — {recrawlReport.changeEvents.length} change
          events, {recrawlLlmCalls} model calls{' '}
          <span className="invariant-note">
            (invariant 1: unchanged hash ⇒ zero LLM touch, zero rewrites)
          </span>
        </dd>

        <dt>2024-07-01 crawl</dt>
        <dd>
          {amendmentReport.changeEvents.length} change event detected:{' '}
          <code>{amendmentReport.changeEvents[0]?.citation ?? '—'}</code> content hash changed
        </dd>

        <dt>model usage</dt>
        <dd>
          {modelUsage.triageCalls} triage call(s), {modelUsage.synthesisCalls} synthesis call(s) —
          mode <code>{modelUsage.mode}</code>. {modelUsage.reason}
        </dd>
      </dl>
    </section>
  );
}
