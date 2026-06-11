import { describe, expect, test } from 'vitest';

import { parseOnboardingForm } from './schema';

const validForm = (overrides?: Record<string, readonly string[]>): FormData => {
  const data = new FormData();
  const fields: Record<string, readonly string[]> = {
    displayName: ['Maren Voss'],
    planId: ['core'],
    jurisdictions: ['us-federal'],
    practiceAreas: ['employment'],
    clientTypes: ['small-business'],
    firmName: [''],
    ...overrides,
  };
  for (const [name, values] of Object.entries(fields)) {
    for (const value of values) {
      data.append(name, value);
    }
  }
  return data;
};

describe('parseOnboardingForm', () => {
  test('accepts a complete valid wizard submission', () => {
    const result = parseOnboardingForm(validForm());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        displayName: 'Maren Voss',
        planId: 'core',
        selection: {
          jurisdictions: ['us-federal'],
          practiceAreas: ['employment'],
          clientTypes: ['small-business'],
        },
        firmName: '',
      });
    }
  });

  test('accepts multi-select submissions', () => {
    const result = parseOnboardingForm(
      validForm({
        planId: ['practice-pro'],
        jurisdictions: ['us-federal', 'us-ca'],
        practiceAreas: ['employment', 'tax'],
        clientTypes: ['small-business', 'startups'],
        firmName: ['Voss Employment Law'],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.selection.jurisdictions).toEqual(['us-federal', 'us-ca']);
      expect(result.value.firmName).toBe('Voss Employment Law');
    }
  });

  test('rejects an empty jurisdiction selection with a human message', () => {
    const result = parseOnboardingForm(validForm({ jurisdictions: [] }));
    expect(result).toEqual({ ok: false, message: 'Select at least one jurisdiction.' });
  });

  test('rejects an empty practice-area selection', () => {
    const result = parseOnboardingForm(validForm({ practiceAreas: [] }));
    expect(result.ok).toBe(false);
  });

  test('rejects unknown jurisdictions instead of passing them through', () => {
    const result = parseOnboardingForm(validForm({ jurisdictions: ['us-tx'] }));
    expect(result).toEqual({ ok: false, message: 'Unknown jurisdiction.' });
  });

  test('rejects unknown plans', () => {
    const result = parseOnboardingForm(validForm({ planId: ['enterprise'] }));
    expect(result).toEqual({ ok: false, message: 'Choose one of the three plans.' });
  });

  test('rejects a missing display name', () => {
    const result = parseOnboardingForm(validForm({ displayName: [''] }));
    expect(result.ok).toBe(false);
  });

  test('trims the display name and firm name', () => {
    const result = parseOnboardingForm(
      validForm({ displayName: ['  Rita Calloway  '], firmName: ['  Calloway CPA  '] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.displayName).toBe('Rita Calloway');
      expect(result.value.firmName).toBe('Calloway CPA');
    }
  });

  test('rejects an oversized firm name at the boundary', () => {
    const result = parseOnboardingForm(validForm({ firmName: ['x'.repeat(121)] }));
    expect(result.ok).toBe(false);
  });

  test('ignores non-string form entries instead of crashing', () => {
    const data = validForm();
    data.append('jurisdictions', new Blob(['x']));
    const result = parseOnboardingForm(data);
    expect(result.ok).toBe(true);
  });
});
