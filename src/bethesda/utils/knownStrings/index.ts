export {
  FO3_TRANSLATABLE_SUBRECORDS,
  FO4_TRANSLATABLE_SUBRECORDS,
  FO76_TRANSLATABLE_SUBRECORDS,
  FNV_TRANSLATABLE_SUBRECORDS,
  GAME_SUBRECORDS_CONFIG_BY_GAME,
  IGNORED_RECORDS_BY_GAME,
  SSE_TRANSLATABLE_SUBRECORDS,
  TRANSLATABLE_SUBRECORDS,
  TRANSLATABLE_SUBRECORDS_BY_GAME,
} from './constants';
export type { GameSubrecordsConfig } from './constants';
export { getTranslatableSubrecords } from './getTranslatableSubrecords';
export { isIgnoredRecord } from './isIgnoredRecord';
export { isTranslatableSubrecord } from './isTranslatableSubrecord';
export { loadGameSubrecordsConfig } from './loadGameSubrecordsConfig';
