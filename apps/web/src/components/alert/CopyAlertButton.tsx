'use client';

import { useState } from 'react';

/**
 * Copy-to-clipboard for the client-alert draft. The text is the exact
 * plain-text rendering produced server-side from the verified artifact —
 * the button never re-derives content.
 */

type CopyState = 'idle' | 'copied' | 'failed';

interface CopyAlertButtonProps {
  readonly text: string;
}

export function CopyAlertButton({ text }: CopyAlertButtonProps) {
  const [state, setState] = useState<CopyState>('idle');

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  return (
    <span className="copy-control">
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void onCopy()}
        data-testid="copy-alert"
      >
        {state === 'copied' ? 'Copied' : 'Copy to clipboard'}
      </button>
      <span aria-live="polite" className="copy-status">
        {state === 'failed' ? 'Clipboard unavailable — select the text below instead.' : ''}
      </span>
    </span>
  );
}
