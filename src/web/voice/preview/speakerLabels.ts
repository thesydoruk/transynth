/**
 * Names for the voice folders of the speaker list.
 *
 * A folder is named on disk as its archive spells it. Fallout 4 archives keep
 * the voice type's own spelling (`NPCMPrestonGarvey`); Starfield's are all
 * lower case (`npcmaaronscott`), which leaves nothing to split into words and
 * does not match the voice type the speaker table stores. The spelling and the
 * character are therefore read from the speaker table, ignoring case.
 *
 * Two folders can also come out with one label — `NPCXOtherPlayer_2` and
 * `UnityVoiceNonBinary_2` are both "2" by the rule that drops a mod prefix.
 * The list never shows two speakers under one name: a label that is not the
 * only one of its kind gives way to the folder's whole name.
 */
import type { Tx } from '../../../db';

/** What the speaker table knows about one voice folder. */
export type VoiceFolderNames = {
  /** The voice type as the plugin spells it, e.g. `NPCMAaronScott`. */
  spelling: string;
  /** The one named character who speaks with it; null for a shared voice type. */
  character: string | null;
};

/** A folder's whole name in words: `NPCXOtherPlayer_2` → `NPCX Other Player 2`. */
export const formatVoiceFolderName = (folderName: string): string =>
  folderName
    .replace(/_+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim() || folderName;

/**
 * Spelling and character of every voice type of a mod, keyed by the folder
 * name in lower case.
 */
export const loadVoiceFolderNames = async (
  db: Tx,
  modId: number,
): Promise<Map<string, VoiceFolderNames>> => {
  const { rows } = await db.query<{ voice_type: string; display_name: string | null }>(
    `SELECT sp.voice_type, sp.display_name
       FROM dialog_speakers sp
      WHERE sp.mod_id = $1
        AND sp.voice_type IS NOT NULL
        AND BTRIM(sp.voice_type) <> ''
        AND NOT sp.is_player
      ORDER BY sp.line_count DESC, sp.id`,
    [modId],
  );

  const characters = new Map<string, Set<string>>();
  const names = new Map<string, VoiceFolderNames>();
  for (const row of rows) {
    const key = row.voice_type.trim().toLowerCase();
    if (!names.has(key)) names.set(key, { spelling: row.voice_type.trim(), character: null });
    const name = row.display_name?.trim();
    if (!name) continue;
    let seen = characters.get(key);
    if (!seen) characters.set(key, (seen = new Set()));
    seen.add(name);
  }
  for (const [key, seen] of characters) {
    if (seen.size === 1) names.get(key)!.character = [...seen][0]!;
  }
  return names;
};

const labelKey = (label: string): string => label.trim().toLowerCase();

/** One pass: every speaker whose label is shared is renamed by `rename`. */
const renameShared = <T extends { key: string; displayName: string }>(
  speakers: readonly T[],
  rename: (speakerKey: string) => string,
): { speakers: T[]; shared: boolean } => {
  const count = new Map<string, number>();
  for (const speaker of speakers) {
    const label = labelKey(speaker.displayName);
    count.set(label, (count.get(label) ?? 0) + 1);
  }
  let shared = false;
  const renamed = speakers.map((speaker) => {
    if ((count.get(labelKey(speaker.displayName)) ?? 0) < 2) return speaker;
    shared = true;
    const displayName = rename(speaker.key);
    return displayName === speaker.displayName ? speaker : { ...speaker, displayName };
  });
  return { speakers: renamed, shared };
};

/**
 * The same speakers with distinct names: wherever two or more share a label,
 * each of them is shown by its folder's whole name instead.
 *
 * A folder's whole name can itself be the label another speaker already has —
 * `genericmale09` becomes "Generic Male 09", the name a line gave
 * `npcmandreas` — so the pass runs again on the result, and whatever is still
 * shared after that is shown by its key, which nothing else has.
 */
export const withDistinctSpeakerNames = <T extends { key: string; displayName: string }>(
  speakers: readonly T[],
  folderName: (speakerKey: string) => string,
): T[] => {
  const first = renameShared(speakers, folderName);
  if (!first.shared) return first.speakers;
  const second = renameShared(first.speakers, folderName);
  if (!second.shared) return second.speakers;
  return renameShared(second.speakers, (speakerKey) => speakerKey).speakers;
};
