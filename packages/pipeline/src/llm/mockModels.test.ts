import { describe, expect, test } from 'vitest';

import type { ChangeEvent } from '@statutory/core';

import { createMockTriageModel, createModelsFromEnv } from './mockModels.js';

const EVENT: ChangeEvent = {
  id: 'evt-1',
  sectionId: 'sec-1',
  citation: '29 CFR § 541.600',
  oldVersionId: 'ver-1',
  newVersionId: 'ver-2',
  detectedAt: '2024-07-01T06:00:00Z',
  diff: { removedParagraphs: ['old'], addedParagraphs: ['new'] },
  status: 'detected',
};

describe('createMockTriageModel', () => {
  test('classifies deterministically and counts calls', async () => {
    // Arrange
    const model = createMockTriageModel();

    // Act
    const first = await model.triage({ changeEvent: EVENT, jurisdiction: 'us-federal', profiles: [] });
    const second = await model.triage({ changeEvent: EVENT, jurisdiction: 'us-federal', profiles: [] });

    // Assert
    expect(first).toEqual(second);
    expect(first.topicId).toBe('exempt-status');
    expect(model.callCount).toBe(2);
  });

  test('returns a null topic for citations outside the taxonomy', async () => {
    // Arrange
    const model = createMockTriageModel();
    const offTopic = { ...EVENT, citation: '29 CFR § 825.100' };

    // Act
    const result = await model.triage({ changeEvent: offTopic, jurisdiction: 'us-federal', profiles: [] });

    // Assert
    expect(result.topicId).toBeNull();
    expect(result.matchedProfileIds).toEqual([]);
  });
});

describe('createModelsFromEnv', () => {
  test('returns deterministic mocks when no API key is set', () => {
    // Act
    const models = createModelsFromEnv({} as NodeJS.ProcessEnv);

    // Assert
    expect(models.mode).toBe('mock');
    expect(models.reason).toMatch(/No ANTHROPIC_API_KEY/);
  });

  test('still returns mocks (never a network client) when a key IS set', () => {
    // Act — M1 must never call an AI API even if a key is present
    const models = createModelsFromEnv({ ANTHROPIC_API_KEY: 'sk-test-fake' } as NodeJS.ProcessEnv);

    // Assert
    expect(models.mode).toBe('mock');
    expect(models.reason).toMatch(/post-M1/);
  });
});
