export type {
  AddresseeResolution,
  NodeAddressee,
  ScenePhaseRow,
  SpeakerNodeRow,
} from './addressees';

export type {
  ActorSpeakerInfo,
  BuildPluginSpeakerIndexOptions,
  PluginSpeakerIndex,
} from './pluginSpeakerIndex';
export { buildPluginSpeakerIndex } from './pluginSpeakerIndex';

export { buildSpeakerActorIndex, loadPluginPathByBasename } from './masterPlugins';

export type { DialogSpeakerRow, SpeakerSourceNode } from './speakerRows';

export type { DialogSpeakerResolution } from './persist';
export { resolveModDialogSpeakers } from './persist';
