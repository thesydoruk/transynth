export {
  AUTO_SELECT_GOOD_ENOUGH_SCORE,
  PREFERRED_REFERENCE_DURATION_MAX_SEC,
  PREFERRED_REFERENCE_DURATION_MIN_SEC,
  speakerReferenceCacheRoot,
} from './constants';
export type { ReferencePcm } from './pcm';
export { readPcmFromWav } from './pcm';
export {
  analyzeReferencePcm,
  analyzeReferenceWav,
  computeHesitationPenalty,
  scoreReferencePcm,
  scoreReferenceWav,
} from './scoring';
export {
  compareAutoSelectMetrics,
  isPreferredAutoSelectPick,
  pickAutoSelectCandidate,
} from './autoSelect';
export { countEnglishSyllables } from './syllables';
export { voiceSpeakerKey, groupVoiceFilesBySpeaker } from './grouping';
export type { VoiceReferenceEligibility } from './eligibility';
export {
  MANUAL_REFERENCE_FORMID,
  isManualVoiceReferencePick,
  isVoiceReferencePickEligible,
  voiceReferenceEligibilityFromSources,
} from './eligibility';
export type { ResolveSpeakerReferenceInput, ResolvedSpeakerReference } from './resolve';
export { resolveSpeakerReferenceForSpeaker } from './resolve';
