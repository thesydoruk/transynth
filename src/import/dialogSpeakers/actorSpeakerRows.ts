import { npcSpeakerKey } from '../../dialog';
import type { PluginSpeakerIndex } from './pluginSpeakerIndex';
import type { DialogSpeakerRow } from './speakerRows';

/**
 * Speaker rows for every NPC_ actor in the plugin index (not only dialog participants).
 *
 * An actor with no line in this mod stores no voice type, although its record
 * names one. The voice tab reads the column as "this speaker's audio is in this
 * folder" and lets every row vote on the folder's gender; silent actors would
 * vote with the sex flag of their record, which robots and templated NPCs carry
 * regardless of the voice (`RobotPAM` would stop reading as female).
 */
export const buildActorSpeakerRowsFromIndex = (
  index: PluginSpeakerIndex,
  skipKeys: ReadonlySet<string> = new Set(),
): DialogSpeakerRow[] => {
  const rows: DialogSpeakerRow[] = [];
  for (const [formId, actor] of index.actors) {
    const speakerKey = npcSpeakerKey(formId);
    if (skipKeys.has(speakerKey)) continue;
    rows.push({
      speakerKey,
      displayName: actor.name,
      voiceType: null,
      isPlayer: actor.isPlayer,
      detectedGender: actor.gender,
      detectedSource: actor.source,
    });
  }
  return rows;
};
