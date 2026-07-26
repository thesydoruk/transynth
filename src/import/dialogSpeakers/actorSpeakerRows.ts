import { npcSpeakerKey } from '../../dialog';
import type { PluginSpeakerIndex } from './pluginSpeakerIndex';
import type { DialogSpeakerRow } from './speakerRows';

/** Speaker rows for every NPC_ actor in the plugin index (not only dialog participants). */
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
      voiceType: actor.voiceType,
      isPlayer: actor.isPlayer,
      detectedGender: actor.gender,
      detectedSource: actor.source,
    });
  }
  return rows;
};
