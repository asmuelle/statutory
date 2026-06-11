import { signInAction, signOutAction } from '../../app/review/actions';

/**
 * Mock reviewer session controls. Review actions are impossible without a
 * named reviewer — the audit trail must always attribute decisions.
 */

export function SignInPanel() {
  return (
    <section className="slice-section review-signin" aria-labelledby="signin-heading">
      <h2 id="signin-heading">Reviewer sign-in</h2>
      <p className="review-signin-note">
        Decisions are recorded against your reviewer id in the append-only audit trail.
      </p>
      <form action={signInAction} className="review-form review-form-inline">
        <label htmlFor="reviewerId">Reviewer id</label>
        <input
          id="reviewerId"
          name="reviewerId"
          type="text"
          required
          minLength={2}
          maxLength={64}
          pattern="[A-Za-z0-9][A-Za-z0-9-]+"
          placeholder="e.g. attorney-voss"
          autoComplete="username"
        />
        <button type="submit" className="btn btn-primary">
          Sign in
        </button>
      </form>
    </section>
  );
}

interface ReviewerBarProps {
  readonly reviewer: string;
}

export function ReviewerBar({ reviewer }: ReviewerBarProps) {
  return (
    <div className="reviewer-bar">
      <span>
        Reviewing as <code data-testid="reviewer-id">{reviewer}</code>
      </span>
      <form action={signOutAction}>
        <button type="submit" className="btn btn-quiet">
          Sign out
        </button>
      </form>
    </div>
  );
}
