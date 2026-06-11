import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import {
  CLIENT_ALERT_TEMPLATE_COPY,
  buildClientAlert,
  capabilitiesFor,
  effectiveStanding,
  entitlementsFor,
  renderClientAlertText,
} from '@statutory/core';

import { CopyAlertButton } from '../../../components/alert/CopyAlertButton';
import { parseDeltaBody } from '../../../lib/deltaBody';
import { getAccount } from '../../account/session';
import { getWorkspace } from '../../workspace';

/**
 * The client-alert draft view (M3) — the billable artifact. Built ONLY from
 * a published, span-verified delta (the core builder throws on anything
 * else); print-optimized in the statute-book direction; white-label
 * letterhead gated to Practice Pro and Small-firm.
 */

export const dynamic = 'force-dynamic';

interface AlertPageProps {
  readonly params: Promise<{ readonly deltaId: string }>;
  readonly searchParams: Promise<{ readonly variant?: string }>;
}

export default async function ClientAlertPage({ params, searchParams }: AlertPageProps) {
  const [{ deltaId }, { variant }] = await Promise.all([params, searchParams]);
  const account = await getAccount();
  if (account === null || account.profile === null) {
    redirect('/onboarding');
  }

  const workspace = await getWorkspace();
  const delta = workspace.store.getDelta(deltaId);
  if (delta === undefined || delta.publishedAt === null) {
    notFound();
  }

  const standing = effectiveStanding(account.billing, new Date().toISOString());
  const capabilities = capabilitiesFor(standing);
  if (!capabilities.canDraftClientAlerts) {
    return (
      <div className="page">
        <main>
          <p className="billing-banner" role="alert" data-testid="draft-paused">
            Your subscription is read-only: the published rulebook remains available on{' '}
            <Link href="/rulebook">your rulebook</Link>, but drafting new client alerts is
            paused until payment resumes.
          </p>
        </main>
      </div>
    );
  }

  const entitlements = entitlementsFor(account.planId, account.addOnJurisdictions);
  const firmName = account.firmName.trim();
  const canWhiteLabel = entitlements.whiteLabelAlerts && firmName.length > 0;
  const useWhiteLabel = variant === 'white-label' && canWhiteLabel;

  const artifact = buildClientAlert({
    delta,
    manifest: workspace.coverageManifest,
    entitlements,
    options: useWhiteLabel
      ? { variant: 'white-label', firmName }
      : { variant: 'standard' },
    generatedAt: new Date().toISOString(),
  });
  const clipboardText = renderClientAlertText(artifact);
  const bodyBlocks = parseDeltaBody(artifact.bodyMd);

  return (
    <div className="page">
      <nav className="alert-toolbar no-print" aria-label="Client alert actions">
        <Link href="/rulebook">← Your rulebook</Link>
        <CopyAlertButton text={clipboardText} />
        {entitlements.whiteLabelAlerts ? (
          firmName.length > 0 ? (
            <span className="variant-switch" data-testid="variant-switch">
              <Link
                href={`/alerts/${deltaId}`}
                aria-current={useWhiteLabel ? undefined : 'page'}
              >
                Statutory branding
              </Link>
              {' · '}
              <Link
                href={`/alerts/${deltaId}?variant=white-label`}
                aria-current={useWhiteLabel ? 'page' : undefined}
                data-testid="white-label-link"
              >
                White-label ({firmName})
              </Link>
            </span>
          ) : (
            <span className="variant-note">
              Add a firm name in <Link href="/onboarding">onboarding</Link> to white-label.
            </span>
          )
        ) : (
          <span className="variant-note" data-testid="white-label-locked">
            White-label is a Practice Pro feature — <Link href="/onboarding">upgrade</Link>.
          </span>
        )}
      </nav>

      <article className="alert-sheet" data-testid="client-alert">
        <header className="alert-letterhead">
          {artifact.branding.variant === 'white-label' ? (
            <>
              <p className="alert-firm" data-testid="alert-firm">
                {artifact.branding.firmName}
              </p>
              <p className="alert-kind">{CLIENT_ALERT_TEMPLATE_COPY.headline}</p>
            </>
          ) : (
            <>
              <p className="alert-kind">{CLIENT_ALERT_TEMPLATE_COPY.headline}</p>
              <p className="alert-byline" data-testid="alert-byline">
                {artifact.branding.productLine}
              </p>
            </>
          )}
        </header>

        <h1 className="alert-title">{artifact.deltaTitle}</h1>
        <p className="alert-effective">
          Effective date: <strong>{artifact.effectiveDate}</strong>
        </p>
        <p className="alert-intro">{CLIENT_ALERT_TEMPLATE_COPY.intro}</p>

        <div className="delta-body alert-body">
          {bodyBlocks.map((block, i) => {
            switch (block.kind) {
              case 'heading':
                return <h2 key={i}>{block.text}</h2>;
              case 'label':
                return (
                  <p key={i} className="delta-label">
                    {block.text}
                  </p>
                );
              case 'removal':
                return (
                  <p key={i} className="alert-redline">
                    <del>{block.text}</del>
                  </p>
                );
              case 'addition':
                return (
                  <p key={i} className="alert-redline">
                    <ins>{block.text}</ins>
                  </p>
                );
              default:
                return <p key={i}>{block.text}</p>;
            }
          })}
        </div>

        <section className="alert-footnote-block" aria-label="Citations">
          <h2 className="alert-section-heading">
            {CLIENT_ALERT_TEMPLATE_COPY.footnoteHeading}
          </h2>
          <ol className="alert-footnotes" data-testid="alert-footnotes">
            {artifact.footnotes.map((footnote) => (
              <li key={footnote.index} id={`fn-${footnote.index}`}>
                <blockquote className="citation-quote">{footnote.quoteSpan}</blockquote>
                <span className="citation-source">
                  {footnote.citation} · effective {footnote.effectiveDate} ·{' '}
                  <span className="stamp stamp-verified">
                    span-verified {footnote.verifiedAt}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <footer className="alert-frame">
          <p className="alert-coverage">
            {CLIENT_ALERT_TEMPLATE_COPY.coverageHeading}: {artifact.frame.coverageStatement}
          </p>
          <p className="alert-closing">{CLIENT_ALERT_TEMPLATE_COPY.closing}</p>
          <p className="legal-framing" data-testid="not-legal-advice">
            {artifact.frame.notLegalAdvice}
          </p>
        </footer>
      </article>
    </div>
  );
}
