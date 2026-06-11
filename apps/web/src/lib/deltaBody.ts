/**
 * Deterministic renderer-side parser for delta bodies. The synthesis step
 * emits a constrained markdown subset (headings, redline removals/additions,
 * bold labels, prose lines); this maps each line to a typed block so the UI
 * renders semantic HTML without any HTML injection (no innerHTML anywhere).
 */

export type DeltaBodyBlock =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'label'; readonly text: string }
  | { readonly kind: 'removal'; readonly text: string }
  | { readonly kind: 'addition'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string };

const HEADING = /^###\s+(.+)$/;
const REMOVAL = /^-\s+~~(.+)~~$/;
const ADDITION = /^-\s+\*\*(.+)\*\*$/;
const LABEL = /^\*\*(.+)\*\*$/;

const parseLine = (line: string): DeltaBodyBlock => {
  const heading = HEADING.exec(line)?.[1];
  if (heading !== undefined) {
    return { kind: 'heading', text: heading };
  }
  const removal = REMOVAL.exec(line)?.[1];
  if (removal !== undefined) {
    return { kind: 'removal', text: removal };
  }
  const addition = ADDITION.exec(line)?.[1];
  if (addition !== undefined) {
    return { kind: 'addition', text: addition };
  }
  const label = LABEL.exec(line)?.[1];
  if (label !== undefined) {
    return { kind: 'label', text: label };
  }
  return { kind: 'paragraph', text: line };
};

/** Parse a delta body into renderable blocks; blank lines are dropped. */
export const parseDeltaBody = (bodyMd: string): readonly DeltaBodyBlock[] =>
  bodyMd
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseLine);
