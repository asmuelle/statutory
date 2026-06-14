import { describe, expect, test } from 'vitest';

import type { CoverageManifest, Delta, PracticeProfile } from '@statutory/core';

import {
  AlertSendError,
  createAlertSenderFromEnv,
  createRecordingAlertSender,
  createResendAlertSender,
  sendDeltaAlert,
} from './alertSender.js';

/**
 * The send gate: a delta alert reaches a transport ONLY if it is published
 * with verified citations. The recording mock proves what the gate let
 * through; the Resend adapter is fetch-stubbed (no network, no key leak).
 */

const PROFILE: PracticeProfile = {
  id: 'profile-1',
  name: 'Jane Counsel',
  jurisdictions: ['us-federal'],
  practiceAreas: ['employment'],
  clientTypes: ['employers'],
};

const MANIFEST: CoverageManifest = {
  jurisdictions: ['us-federal'],
  topics: ['exempt-status'],
  sources: ['eCFR', 'Federal Register'],
  notMonitored: [],
};

const publishedDelta = (): Delta => ({
  id: 'delta-1',
  jurisdiction: 'us-federal',
  topic: 'exempt-status',
  changeEventIds: ['evt-1'],
  title: 'Salary threshold rises to $844/week',
  bodyMd: 'The standard salary level changes effective July 1, 2024.',
  effectiveDate: '2024-07-01',
  citations: [
    {
      citation: '29 CFR § 541.600',
      sectionVersionId: 'ver-2',
      quoteSpan: '$844 per week',
      verifiedAt: '2024-07-02T00:00:00Z',
    },
  ],
  verificationStatus: 'verified',
  publishedAt: '2024-07-02T00:00:00Z',
});

describe('sendDeltaAlert — the send gate fires before any transport', () => {
  test('a published, verified delta is sent', async () => {
    const sender = createRecordingAlertSender();
    const receipt = await sendDeltaAlert(
      sender,
      publishedDelta(),
      MANIFEST,
      PROFILE,
      'jane@firm.example',
    );

    expect(receipt.to).toBe('jane@firm.example');
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.alert.subject).toMatch(/Salary threshold/);
  });

  test('an UNPUBLISHED delta is refused and the transport is never reached', async () => {
    const sender = createRecordingAlertSender();
    const draft = {
      ...publishedDelta(),
      publishedAt: null,
      verificationStatus: 'pending' as const,
    };

    await expect(
      sendDeltaAlert(sender, draft, MANIFEST, PROFILE, 'jane@firm.example'),
    ).rejects.toThrow();
    expect(sender.sent).toHaveLength(0); // gate fired first
  });

  test('a published delta with an UNVERIFIED citation is refused before sending', async () => {
    const sender = createRecordingAlertSender();
    const delta = publishedDelta();
    const tampered: Delta = {
      ...delta,
      citations: delta.citations.map((c) => ({ ...c, verifiedAt: null })),
    };

    await expect(
      sendDeltaAlert(sender, tampered, MANIFEST, PROFILE, 'jane@firm.example'),
    ).rejects.toThrow();
    expect(sender.sent).toHaveLength(0);
  });

  test('an empty recipient is rejected', async () => {
    const sender = createRecordingAlertSender();
    await expect(
      sendDeltaAlert(sender, publishedDelta(), MANIFEST, PROFILE, ''),
    ).rejects.toBeInstanceOf(AlertSendError);
  });
});

describe('createResendAlertSender — fetch-stubbed transport', () => {
  test('POSTs to /emails with bearer auth and returns the message id', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ id: 'resend-123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const sender = createResendAlertSender({
      apiKey: 'resend-secret-key',
      from: 'alerts@statutory.app',
      fetchImpl,
    });
    const receipt = await sender.send({ subject: 'Hi', body: 'Body' }, 'jane@firm.example');

    expect(receipt.id).toBe('resend-123');
    const { url, init } = captured as unknown as { url: string; init: RequestInit };
    expect(url).toMatch(/\/emails$/);
    const headers = init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer resend-secret-key');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['to']).toBe('jane@firm.example');
    expect(body['subject']).toBe('Hi');
  });

  test('a non-OK response never leaks the API key', async () => {
    const fetchImpl = (async () =>
      new Response('forbidden', { status: 403 })) as unknown as typeof fetch;
    const sender = createResendAlertSender({
      apiKey: 'resend-secret-key',
      from: 'alerts@statutory.app',
      fetchImpl,
    });

    await expect(
      sender.send({ subject: 'Hi', body: 'Body' }, 'jane@firm.example'),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof Error && !e.message.includes('resend-secret-key'),
    );
  });
});

describe('createAlertSenderFromEnv', () => {
  test('uses the recording mock when RESEND_API_KEY is absent', () => {
    const sender = createAlertSenderFromEnv({} as NodeJS.ProcessEnv);
    expect(sender.name).toBe('recording-mock');
  });

  test('selects the Resend adapter when RESEND_API_KEY is present', () => {
    const sender = createAlertSenderFromEnv({ RESEND_API_KEY: 'k' } as NodeJS.ProcessEnv);
    expect(sender.name).toBe('resend');
  });
});
