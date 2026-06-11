import { purchaseAddOnAction, upgradeToProAction } from '../../app/onboarding/actions';
import type { OnboardingPrefill } from '../../app/onboarding/urlState';

/**
 * The upgrade prompt rendered when a wizard submission hits a plan limit.
 * Selections are preserved as hidden fields, so the purchase/upgrade action
 * can hand them straight back to the form.
 */

function HiddenPrefillFields({ prefill }: { readonly prefill: OnboardingPrefill }) {
  return (
    <>
      <input type="hidden" name="displayName" value={prefill.displayName} />
      <input type="hidden" name="planId" value={prefill.planId} />
      {prefill.jurisdictions.map((j) => (
        <input key={j} type="hidden" name="jurisdictions" value={j} />
      ))}
      {prefill.practiceAreas.map((pa) => (
        <input key={pa} type="hidden" name="practiceAreas" value={pa} />
      ))}
      {prefill.clientTypes.map((ct) => (
        <input key={ct} type="hidden" name="clientTypes" value={ct} />
      ))}
      <input type="hidden" name="firmName" value={prefill.firmName} />
    </>
  );
}

interface UpgradePromptProps {
  readonly kind: 'jurisdiction' | 'specialty';
  readonly message: string;
  readonly prefill: OnboardingPrefill;
}

export function UpgradePrompt({ kind, message, prefill }: UpgradePromptProps) {
  return (
    <aside className="upgrade-prompt" data-testid="upgrade-prompt" role="alert">
      <h2>Plan limit reached</h2>
      <p data-testid="upgrade-message">{message}</p>
      <div className="upgrade-actions">
        {kind === 'jurisdiction' ? (
          <form action={purchaseAddOnAction}>
            <HiddenPrefillFields prefill={prefill} />
            <button type="submit" className="btn btn-primary" data-testid="purchase-addon">
              Add a jurisdiction — $19/mo
            </button>
          </form>
        ) : (
          <form action={upgradeToProAction}>
            <HiddenPrefillFields prefill={prefill} />
            <button type="submit" className="btn btn-primary" data-testid="upgrade-to-pro">
              Upgrade to Practice Pro — $99/mo
            </button>
          </form>
        )}
      </div>
      <p className="upgrade-note">
        Your selections are kept — confirm, then complete onboarding below.
      </p>
    </aside>
  );
}
