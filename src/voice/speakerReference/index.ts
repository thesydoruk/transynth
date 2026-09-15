export { AUTO_SELECT_GOOD_ENOUGH_SCORE, speakerReferenceCacheRoot } from './constants';
export type { ReferencePcm } from './pcm';

export { computeHesitationPenalty, scoreReferencePcm, scoreReferenceWav } from './scoring';

export { voiceSpeakerKey, groupVoiceFilesBySpeaker } from './grouping';
export type { VoiceReferenceEligibility } from './eligibility';
export { isManualVoiceReferencePick, voiceReferenceEligibilityFromSources } from './eligibility';
export type { ResolveSpeakerReferenceInput, ResolvedSpeakerReference } from './resolve';
export { resolveSpeakerReferenceForSpeaker } from './resolve';
