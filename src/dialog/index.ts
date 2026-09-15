export type {
  AddresseeKind,
  DialogLineParticipants,
  GenderSource,
  SpeakerGender,
  SpeakerGenderRecord,
} from './gender';
export {
  PLAYER_SPEAKER_KEY,
  effectiveSpeakerGenderSql,
  isDefiniteGender,
  npcSpeakerKey,
  parseSpeakerGender,
  resolveDialogLineParticipants,
  voiceFolderSpeakerKey,
} from './gender';

export type { PronounEvidence } from './pronounEvidence';
export { collectPronounEvidence } from './pronounEvidence';

export type { UkCalqueMatch, UkCalqueRule } from './ukrainianCalques';
export {
  describeUkrainianCalques,
  findUkrainianCalques,
  promptCalqueRules,
} from './ukrainianCalques';

export {
  genderFromVoiceTypeHeuristic,
  genderFromVoiceTypeName,
  isPlayerVoiceType,
  playerSpeakerGenderFromVoiceKey,
  resolveGenderFromVoiceTypeName,
} from './voiceTypeGender';

export type { UkGenderConflict, UkGenderMarker } from './ukrainianGender';
export { findUkrainianGenderConflicts } from './ukrainianGender';

export type { NarratorGender, NarratorGenderSource } from './narratorGender';
