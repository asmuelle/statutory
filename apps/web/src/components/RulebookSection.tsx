import type { RulebookSectionView } from '@statutory/pipeline';

interface RulebookSectionProps {
  readonly view: RulebookSectionView;
}

/**
 * The amended rulebook section: current canonical text, redline of the
 * amendment, and the append-only version ledger (invariant 7) with content
 * hashes and retrieval provenance.
 */
export function RulebookSection({ view }: RulebookSectionProps) {
  const { section, currentVersion, versions, redline } = view;
  return (
    <section className="slice-section" aria-labelledby="rulebook-heading">
      <h2 id="rulebook-heading">Rulebook — amended section</h2>
      <article>
        <span className="rulebook-citation">{section.citation}</span>
        <h3 className="rulebook-heading">{section.heading}</h3>

        <div className="rulebook-text">
          {currentVersion.normalizedParagraphs.map((paragraph) => (
            <p key={paragraph.slice(0, 48)}>{paragraph}</p>
          ))}
        </div>

        <h4 className="delta-label">Redline (2024-04-01 → 2024-07-01)</h4>
        <ul className="redline-list">
          {redline.removedParagraphs.map((paragraph) => (
            <li key={`del-${paragraph.slice(0, 48)}`}>
              <del>{paragraph}</del>
            </li>
          ))}
          {redline.addedParagraphs.map((paragraph) => (
            <li key={`ins-${paragraph.slice(0, 48)}`}>
              <ins>{paragraph}</ins>
            </li>
          ))}
        </ul>

        <ol className="version-ledger" aria-label="Version history (append-only)">
          {versions.map((version) => (
            <li key={version.id}>
              <span>{version.id === section.currentVersionId ? 'current' : 'superseded'}</span>
              <span className="version-hash">sha256 {version.contentHash.slice(0, 16)}…</span>
              <span>retrieved {version.retrievedAt}</span>
              <span>{version.sourceUrl}</span>
            </li>
          ))}
        </ol>
      </article>
    </section>
  );
}
