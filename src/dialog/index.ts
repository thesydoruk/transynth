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
  resolveGenderFromVoiceTypeName,
} from './voiceTypeGender';

export type { UkGenderConflict, UkGenderMarker } from './ukrainianGender';
export { detectUkrainianGenderMarkers, findUkrainianGenderConflicts } from './ukrainianGender';
