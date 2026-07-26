export type {
  AddresseeKind,
  DialogLineParticipants,
  GenderSource,
  SpeakerGender,
  SpeakerGenderRecord,
} from './gender';
export {
  PLAYER_SPEAKER_KEY,
  effectiveSpeakerGender,
  effectiveSpeakerGenderSql,
  isDefiniteGender,
  npcSpeakerKey,
  parseSpeakerGender,
  resolveDialogLineParticipants,
  voiceFolderSpeakerKey,
} from './gender';

export {
  genderFromVoiceTypeHeuristic,
  genderFromVoiceTypeName,
  isPlayerVoiceType,
  playerSpeakerGenderFromVoiceKey,
  resolveGenderFromVoiceTypeName,
} from './voiceTypeGender';

export type { UkGenderConflict, UkGenderMarker } from './ukrainianGender';
export { detectUkrainianGenderMarkers, findUkrainianGenderConflicts } from './ukrainianGender';

export type { NarratorGender, NarratorGenderSource } from './narratorGender';
export {
  GENDER_DETECT_SOURCE_EXCERPT_MAX,
  NARRATIVE_PATH_SUFFIXES,
  NARRATIVE_RECORD_SIGNATURES,
  effectiveNarratorGenderSql,
  isNarrativeRecordPath,
  narratorToSpeakerGender,
  parseNarratorGender,
} from './narratorGender';
export { inferNarratorGenderHeuristic } from './narratorGenderHeuristics';
