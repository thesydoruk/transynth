/**
 * The voice folder each line of a plugin is filed under, and its speaker label.
 *
 * A title whose INFOs list no voice types (Fallout 4 and older) reads them off
 * the `<FormID>_<n>.fuz` folders beside the plugin, exactly as before layouts
 * existed. A title whose responses list them (Starfield `TROT`) combines that
 * list with the folders of WEM-named takes and the player's scene choices.
 */
import type { EspActorIndex, EspReader, EspStringRow } from '../../../formats/esp';
import { resolveLineVoiceFolders, type LineVoiceFolders } from './lineVoiceTypes';
import { PLAYER_ALIAS_ID } from '../../../import/dialogSpeakers/addressees';
import type { PluginSpeakerIndex } from '../../../import/dialogSpeakers/pluginSpeakerIndex';
import {
  buildVoiceFolderMap,
  buildWemTakeFolders,
  voiceSpeakerNamesFromFolders,
} from '../../../import/mod/speakerMaps';

export type { LineVoiceFolders };

/**
 * Lower-6 FormIDs of the INFOs in the topics scenes give the player to say:
 * the player's side of a choice, and any action of the player alias.
 */
const playerLineKeys = (esp: EspReader, espRows: readonly EspStringRow[]): Set<string> => {
  const playerTopics = new Set<string>();
  for (const scene of esp.extractScenes()) {
    for (const action of scene.actions) {
      const topics =
        action.aliasId === PLAYER_ALIAS_ID
          ? action.topicFormIds
          : (action.playerTopicFormIds ?? []);
      for (const topic of topics) playerTopics.add(topic);
    }
  }
  const keys = new Set<string>();
  if (playerTopics.size === 0) return keys;
  for (const row of espRows) {
    if (row.signature !== 'INFO' || !row.dialogTopicFormId) continue;
    if (playerTopics.has(row.dialogTopicFormId)) keys.add(row.formId.substring(2));
  }
  return keys;
};

export const buildLineVoiceFolders = (opts: {
  esp: EspReader;
  pluginPath: string;
  espRows: readonly EspStringRow[];
  actorIndex: EspActorIndex;
  /** Speaker facts of the plugin; its own `voiceFolders` are not read. */
  speakerIndex: PluginSpeakerIndex;
}): LineVoiceFolders => {
  if (!opts.esp.layout.infoResponseVoiceTypes) {
    const voiceFolders = buildVoiceFolderMap(opts.pluginPath);
    return { voiceFolders, speakerNames: voiceSpeakerNamesFromFolders(voiceFolders) };
  }

  return resolveLineVoiceFolders(
    {
      listed: opts.esp.extractInfoResponseVoiceTypes(),
      voiceTypeNames: new Map(
        opts.actorIndex.voiceTypes
          .filter((voiceType) => voiceType.edid)
          .map((voiceType) => [voiceType.formId, voiceType.edid]),
      ),
      takeFolders: buildWemTakeFolders(opts.pluginPath),
      playerLineKeys: playerLineKeys(opts.esp, opts.espRows),
    },
    opts.speakerIndex,
  );
};
