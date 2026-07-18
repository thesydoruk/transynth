export {
  dedupeVoiceFiles,
  discoverVoiceFiles,
  resolveVoiceRootRel,
  type VoiceFileEntry,
} from './discoverVoiceFiles';
export {
  findImportedMasterMods,
  formatInheritedFromLabel,
  loadInheritedVoiceLookup,
  lookupInheritedVoiceLine,
  readMasterPluginNames,
  type InheritedVoiceLine,
  type InheritedVoiceLookup,
  type MasterModRef,
} from './inheritedVoiceText';
export {
  INFO_NAM1_RECORD_PATHS,
  loadVoiceSources,
  loadVoiceSourcesDetailed,
  loadVoiceTranslations,
  lookupVoiceSource,
  lookupVoiceTranslation,
  normalizeVoiceText,
  voiceTranslationMapKey,
  type VoiceSourceDetailRow,
  type VoiceSourceRow,
  type VoiceTranslationRow,
} from './loadVoiceTranslations';
export {
  AUTO_SELECT_GOOD_ENOUGH_SCORE,
  groupVoiceFilesBySpeaker,
  resolveSpeakerReferenceForSpeaker,
  speakerReferenceCacheRoot,
  voiceSpeakerKey,
  type ResolvedSpeakerReference,
} from './speakerReferencePool';
export {
  clearVoiceSpeakerRef,
  loadVoiceSpeakerRef,
  loadVoiceSpeakerRefs,
  loadVoiceSpeakerRefsMap,
  migrateVoiceSpeakerRefsFromJsonIfNeeded,
  normalizeVoiceSpeakerRefPick,
  setVoiceSpeakerRef,
  voiceSpeakerRefMatches,
  type VoiceSpeakerRefMap,
  type VoiceSpeakerRefPick,
} from './voiceSpeakerRefs';
export {
  countVoiceLocalizeWork,
  localizeModImportVoice,
  type LocalizeModImportVoiceOptions,
  type LocalizeModImportVoiceResult,
  type ModVoiceGenerateScope,
} from './localizeModImportVoice';
