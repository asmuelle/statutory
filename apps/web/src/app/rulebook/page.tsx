import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  capabilitiesFor,
  effectiveStanding,
  entitlementsFor,
  planById,
  scopeRulebook,
} from '@statutory/core';

import { CoverageFooter } from '../../components/CoverageFooter';
import { getAccount } from '../account/session';
import { getWorkspace } from '../workspace';

/**
 * The profile-scoped rulebook (M3): completing onboarding scopes both the
 * section list and the published delta feed to the practice profile via the
 * existing matching pipeline. Read access NEVER degrades with billing
 * standing — read-only mode pauses drafting and alerts, not the record.
 */

export const dynamic = 'force-dynamic';

const STANDING_LABEL: Record<string, string> = {
  active: 'active',
  payment_failed: 'payment failed — retrying',
  grace: 'grace period',
  read_only: 'read-only',
};

export default async function RulebookPage() {
  const account = await getAccount();
  if (account === null || account.profile === null) {
    redirect('/onboarding');
  }
  const profile = account.profile;

  const workspace = await getWorkspace();
  const scoped = scopeRulebook(profile, workspace.store.listSections(), workspace.store.listDeltas());
  const standing = effectiveStanding(account.billing, new Date().toISOString());
  const capabilities = capabilitiesFor(standing);
  const entitlements = entitlementsFor(account.planId, account.addOnJurisdictions);

  return (
    <div className="page">
      <header className="masthead masthead-compact">
        <p className="masthead-kicker">
          <Link href="/">← Pipeline demo</Link> · <Link href="/onboarding">Adjust profile</Link>
        </p>
        <h1 className="masthead-brand">Your rulebook</h1>
        <p className="masthead-tagline">
          Scoped to your practice profile. Every section carries provenance; every delta was
          span-verified and attorney-approved before it reached this page.
        </p>
      </header>

      <main>
        {standing !== 'active' ? (
          <p className="billing-banner" data-testid="billing-banner" role="status">
            Subscription standing: {STANDING_LABEL[standing]}.{' '}
            {capabilities.canDraftClientAlerts
              ? 'Everything keeps working while we retry your payment.'
              : 'Your published rulebook stays available; drafting and alerts are paused until payment resumes.'}
          </p>
        ) : null}

        <section className="slice-section" aria-labelledby="profile-heading">
          <h2 id="profile-heading">Practice profile</h2>
          <dl className="profile-summary" data-testid="profile-summary">
            <dt>Professional</dt>
            <dd>{profile.name}</dd>
            <dt>Plan</dt>
            <dd>
              {planById(account.planId).label} · {entitlements.jurisdictionLimit} jurisdiction
              {entitlements.jurisdictionLimit === 1 ? '' : 's'} ·{' '}
              <span className={`stamp ${standing === 'active' ? 'stamp-verified' : 'stamp-pending'}`}>
                {STANDING_LABEL[standing]}
              </span>
            </dd>
            <dt>Jurisdictions</dt>
            <dd>{profile.jurisdictions.join(', ')}</dd>
            <dt>Practice areas</dt>
            <dd>{profile.practiceAreas.join(', ')}</dd>
            <dt>Client types</dt>
            <dd>{profile.clientTypes.join(', ')}</dd>
          </dl>
        </section>

        <section className="slice-section" aria-labelledby="feed-heading">
          <h2 id="feed-heading">Delta feed — published changes matching your profile</h2>
          {scoped.deltas.length === 0 ? (
            <p className="empty-note">
              No published deltas match your profile yet. Quiet weeks are still verified:
              your rulebook below is confirmed current against the monitored sources.
            </p>
          ) : (
            <ol className="delta-feed" data-testid="delta-feed">
              {scoped.deltas.map((delta) => (
                <li key={delta.id} className="delta-entry" data-testid="delta-feed-entry">
                  <p className="delta-margin-note">
                    <span className="stamp stamp-verified">published {delta.publishedAt}</span> ·
                    effective {delta.effectiveDate}
                  </p>
                  <h3 className="delta-title">{delta.title}</h3>
                  <p className="delta-feed-actions">
                    <Link href={`/alerts/${delta.id}`} className="btn btn-primary">
                      Draft client alert →
                    </Link>
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="slice-section" aria-labelledby="sections-heading">
          <h2 id="sections-heading">Monitored sections in your rulebook</h2>
          {scoped.sections.length === 0 ? (
            <p className="empty-note">
              No monitored sections map to this profile yet — coverage for your practice areas
              ships incrementally and the manifest below is the honest boundary.
            </p>
          ) : (
            <ul className="scoped-sections">
              {scoped.sections.map((section) => {
                const version = workspace.store.getVersion(section.currentVersionId);
                return (
                  <li key={section.id} data-testid="scoped-section">
                    <span className="rulebook-citation">{section.citation}</span>
                    <span className="scoped-heading">{section.heading}</span>
                    {version !== undefined ? (
                      <span className="citation-provenance">
                        sha256 {version.contentHash.slice(0, 16)}… · retrieved{' '}
                        {version.retrievedAt} · {version.sourceUrl}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      <CoverageFooter manifest={workspace.coverageManifest} />
    </div>
  );
}
