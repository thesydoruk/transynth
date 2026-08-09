export type {
  CharacterUkVoiceLink,
  UkVoiceAge,
  UkVoiceAutoMapProposal,
  UkVoiceCharacter,
  UkVoiceGender,
  UkVoiceLibraryRow,
  UkVoiceSource,
} from './types';
export { ageDistance, inferCharacterAge, parseCvAge } from './ageBand';
export { buildUkVoiceAutoMap } from './autoMap';
export { listUkVoiceCharacters } from './characters';
export {
  clearAllCharacterUkVoiceLinks,
  clearCharacterUkVoiceLink,
  deleteUkVoicesNotIn,
  deleteUkVoicesWithBadTranscripts,
  getCharacterUkVoiceLink,
  getUkVoiceById,
  listCharacterUkVoiceLinks,
  listUkVoiceLibrary,
  replaceCharacterUkVoiceLinks,
  setCharacterUkVoiceLink,
  upsertUkVoiceLibraryRow,
} from './db';
export { ukVoiceAudioAbsPath } from './paths';
export { resolveUkLibraryReference } from './resolve';
export type { ResolvedUkLibraryReference } from './resolve';
export { runUkVoiceLibraryImport } from './import/runImport';
export { cacheUkVoiceDatasets } from './import/cacheDatasets';
export type { CacheUkVoiceDatasetsResult } from './import/cacheDatasets';
export { isRobotVoiceFolder } from './robotFolders';
export { analyzeUkVoiceLibrary } from './analyzeLibrary';
export type { AnalyzeUkVoiceLibraryResult } from './analyzeLibrary';
export { analyzeUkVoiceWav, scoreUkVoiceQuality } from './analyzeClip';
