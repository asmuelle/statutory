import { topicById } from './taxonomy.js';
import type { Jurisdiction, PracticeProfile, TopicId } from './types.js';

/**
 * Profile matching: a delta reaches exactly the profiles whose monitored
 * jurisdictions include the delta's jurisdiction AND whose practice areas
 * include the delta topic's practice area. Pure and deterministic — fan-out
 * must never depend on a model (invariant 6).
 */
export const matchProfiles = (
  jurisdiction: Jurisdiction,
  topic: TopicId,
  profiles: readonly PracticeProfile[],
): readonly PracticeProfile[] => {
  const practiceArea = topicById(topic).practiceArea;
  return profiles.filter(
    (p) => p.jurisdictions.includes(jurisdiction) && p.practiceAreas.includes(practiceArea),
  );
};
