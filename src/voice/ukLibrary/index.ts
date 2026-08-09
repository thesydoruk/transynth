export type {
  CharacterUkVoiceLink,
  UkVoiceAutoMapProposal,
  UkVoiceCharacter,
  UkVoiceGender,
  UkVoiceLibraryRow,
  UkVoiceSource,
} from './types';
export { buildUkVoiceAutoMap } from './autoMap';
export { listUkVoiceCharacters } from './characters';
export {
  clearCharacterUkVoiceLink,
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
export { isRobotVoiceFolder } from './robotFolders';
