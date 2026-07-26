export type {
  AddresseeResolution,
  NodeAddressee,
  ScenePhaseRow,
  SpeakerNodeRow,
} from './addressees';
export { resolveNodeAddressees } from './addressees';

export type { DialogSpeakerBackfillResult, DialogSpeakerBackfillTarget } from './backfill';
export { backfillModDialogSpeakers, listDialogSpeakerBackfillTargets } from './backfill';

export type {
  ActorSpeakerInfo,
  BuildPluginSpeakerIndexOptions,
  PluginSpeakerIndex,
} from './pluginSpeakerIndex';
export { buildPluginSpeakerIndex, genderFromVoiceTypeIndex } from './pluginSpeakerIndex';

export {
  buildSpeakerActorIndex,
  loadPluginPathByBasename,
  mergeActorIndexes,
  resolveMasterPluginPath,
} from './masterPlugins';

export type { DialogSpeakerRow, SpeakerSourceNode } from './speakerRows';
export { buildDialogSpeakerRows } from './speakerRows';
export { buildActorSpeakerRowsFromIndex } from './actorSpeakerRows';

export type { DialogSpeakerResolution } from './persist';
export { resolveModDialogSpeakers } from './persist';
