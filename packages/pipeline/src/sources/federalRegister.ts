import { z } from 'zod';

/**
 * Boundary validation for Federal Register API documents (the fixture mirrors
 * the live API's JSON shape). External data is never trusted unvalidated.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const federalRegisterDocSchema = z.object({
  document_number: z.string().min(1),
  title: z.string().min(1),
  type: z.enum(['Rule', 'Proposed Rule', 'Notice']),
  agencies: z.array(z.string().min(1)).min(1),
  publication_date: z.string().regex(ISO_DATE),
  effective_on: z.string().regex(ISO_DATE),
  citation: z.string().min(1),
  cfr_references: z.array(z.object({ title: z.number().int(), part: z.number().int() })).min(1),
  html_url: z.string().url(),
  body_excerpt: z.string().min(40),
});

export type FederalRegisterDoc = z.infer<typeof federalRegisterDocSchema>;

export class FederalRegisterParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FederalRegisterParseError';
  }
}

/** Validate an already-parsed Federal Register document value. */
export const validateFederalRegisterDoc = (json: unknown): FederalRegisterDoc => {
  const result = federalRegisterDocSchema.safeParse(json);
  if (!result.success) {
    throw new FederalRegisterParseError(`Schema validation failed: ${result.error.message}`);
  }
  return result.data;
};

/** Parse and validate a Federal Register document payload. */
export const parseFederalRegisterDoc = (payload: string): FederalRegisterDoc => {
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch (cause) {
    throw new FederalRegisterParseError(`Invalid JSON: ${String(cause)}`);
  }
  return validateFederalRegisterDoc(json);
};
