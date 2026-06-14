import type { CoverageManifest, Delta, PracticeProfile } from '@statutory/core';

import { renderEmailAlert } from './alerts.js';
import type { EmailAlert } from './alerts.js';

/**
 * Alert delivery seam. Sending sits behind an interface with a deterministic
 * recording mock (the default); the real Resend adapter is config-gated on
 * RESEND_API_KEY and never constructed without one. The crucial invariant:
 * `sendDeltaAlert` renders through `renderEmailAlert` FIRST, which throws for
 * any unpublished or unverified delta — so a transport is never even reached
 * for content that has not cleared the gate (invariants 8, 9).
 */

export const RESEND_API_BASE = 'https://api.resend.com';

export interface SentReceipt {
  readonly id: string;
  readonly to: string;
}

export interface AlertSender {
  readonly name: string;
  send(alert: EmailAlert, to: string): Promise<SentReceipt>;
}

export class AlertSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlertSendError';
  }
}

/** Recording mock — the default. Captures everything it is asked to send so
 *  tests can assert the gate let exactly the right alerts through. */
export interface RecordingAlertSender extends AlertSender {
  readonly sent: readonly { readonly alert: EmailAlert; readonly to: string }[];
}

export const createRecordingAlertSender = (): RecordingAlertSender => {
  const sent: { alert: EmailAlert; to: string }[] = [];
  return {
    name: 'recording-mock',
    get sent() {
      return sent;
    },
    async send(alert, to) {
      sent.push({ alert, to });
      return { id: `mock-${sent.length}`, to };
    },
  };
};

export interface ResendConfig {
  readonly apiKey: string;
  readonly from: string;
  readonly fetchImpl?: typeof fetch;
  readonly apiBase?: string;
}

const resendResponseSchema = (json: unknown): string => {
  if (typeof json === 'object' && json !== null && 'id' in json) {
    const id = (json as { id: unknown }).id;
    if (typeof id === 'string' && id.length > 0) {
      return id;
    }
  }
  throw new AlertSendError('Resend response did not contain a message id.');
};

/** Real Resend adapter. The API key travels only in the Authorization header
 *  and never appears in thrown errors. */
export const createResendAlertSender = (config: ResendConfig): AlertSender => {
  if (config.apiKey.length === 0) {
    throw new AlertSendError('Resend adapter requires a non-empty API key.');
  }
  const fetchImpl = config.fetchImpl ?? fetch;
  const apiBase = config.apiBase ?? RESEND_API_BASE;

  return {
    name: 'resend',
    async send(alert, to) {
      let response: Response;
      try {
        response = await fetchImpl(`${apiBase}/emails`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from: config.from,
            to,
            subject: alert.subject,
            text: alert.body,
          }),
        });
      } catch (cause) {
        throw new AlertSendError(`Resend request failed: ${String(cause).slice(0, 200)}`);
      }
      if (!response.ok) {
        throw new AlertSendError(`Resend returned HTTP ${response.status}.`);
      }
      let json: unknown;
      try {
        json = await response.json();
      } catch (cause) {
        throw new AlertSendError(`Resend response is not JSON: ${String(cause).slice(0, 120)}`);
      }
      return { id: resendResponseSchema(json), to };
    },
  };
};

export const createAlertSenderFromEnv = (env: NodeJS.ProcessEnv = process.env): AlertSender => {
  const apiKey = env['RESEND_API_KEY'] ?? '';
  const from = env['RESEND_FROM'] ?? 'alerts@statutory.app';
  if (apiKey.length > 0) {
    return createResendAlertSender({ apiKey, from });
  }
  return createRecordingAlertSender();
};

/**
 * Render-then-send. `renderEmailAlert` is the gate: it throws for any delta
 * that is not published with verified citations, so the sender is only ever
 * invoked for content that cleared the deterministic verification gate.
 */
export const sendDeltaAlert = async (
  sender: AlertSender,
  delta: Delta,
  manifest: CoverageManifest,
  profile: PracticeProfile,
  to: string,
): Promise<SentReceipt> => {
  const alert = renderEmailAlert(delta, manifest, profile); // throws if not publishable
  if (to.length === 0) {
    throw new AlertSendError(`No recipient address for profile ${profile.id}.`);
  }
  return sender.send(alert, to);
};
