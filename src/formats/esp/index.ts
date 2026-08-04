export { EspReader } from './EspReader';
export type {
  ActorRecord,
  BranchRecord,
  DialOwnership,
  DialogStructureExtract,
  EspActorIndex,
  VoiceTypeRecord,
  EspGrupInfo,
  EspPluginInfo,
  EspRecordsPage,
  EspRecordView,
  EspStringRow,
  EspSubrecordView,
  QuestRecord,
  SceneAction,
  SceneRecord,
} from './EspReader';
export { patchEsp, patchStringsMap } from './espPatcher';
export { readPluginMasterNames } from './pluginHeader';
export { parseSubrecordPath } from './subrecordPath';
export type { SubrecordRef } from './subrecordPath';
