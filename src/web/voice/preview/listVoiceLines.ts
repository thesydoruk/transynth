import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { getVoiceListContext } from './voiceListContext';
import {
  buildVoiceLinePreview,
  resolveSpeakerDisplayName,
  resolveSpeakerKey,
  sortVoiceLines,
} from './buildVoiceLinePreview';
import type { VoiceLinesListResult, VoiceSpeakerGroup } from './types';

/** List all voice lines for a mod, grouped by NPC speaker folder. */
export const listVoiceLinesForMod = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<VoiceLinesListResult> => {
  const loaded = await getVoiceListContext(db, modId, srcLang, targetLang, {
    loadInherited: true,
  });
  if (!loaded.ok) return loaded;

  const context = loaded.data;
  const groups = new Map<string, VoiceSpeakerGroup>();

  for (const entry of context.voiceFiles) {
    const speakerKey = resolveSpeakerKey(entry, context.voiceRootRel);
    let group = groups.get(speakerKey);
    if (!group) {
      const folderGender = context.folderGenders.get(speakerKey);
      group = {
        key: speakerKey,
        displayName: resolveSpeakerDisplayName(
          speakerKey,
          entry.formidLower6,
          context.dbSpeakerNames,
        ),
        referencePick: context.speakerRefs[speakerKey] ?? null,
        gender: folderGender?.gender ?? 'unknown',
        genderMismatch: folderGender?.mismatch ?? false,
        lines: [],
      };
      groups.set(speakerKey, group);
    }

    group.lines.push(buildVoiceLinePreview(context, entry, speakerKey));
  }

  const speakers = [...groups.values()]
    .map((group) => ({
      ...group,
      referencePick: context.speakerRefs[group.key] ?? null,
      lines: sortVoiceLines(group.lines),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));

  const totalLines = speakers.reduce((sum, group) => sum + group.lines.length, 0);
  log.debug(`Voice list mod=${modId}: ${totalLines} lines in ${speakers.length} speaker groups`);
  return { ok: true, speakers, totalLines };
};
