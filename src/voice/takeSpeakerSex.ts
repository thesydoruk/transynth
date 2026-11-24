/**
 * Sex of the speaker behind a voice folder, for take formats whose lip-sync is
 * built on a male or a female face rig (`VoiceTakeFormat.needsSpeakerSex`).
 *
 * In order:
 *   1. what the import knows about the voice type — the plugin's `VTYP` flag or
 *      an operator's override, as stored on the mod's dialog speakers;
 *   2. what the folder name says (`NPCFAndreja`, `FemaleEvenToned`);
 *   3. {@link DEFAULT_FACEFX_ACTOR}.
 *
 * A master's voice type the mod never declares has no stored speaker, so a take
 * borrowed from a master usually resolves at step 2.
 */
import type { Tx } from '../db';
import { isDefiniteGender, resolveGenderFromVoiceTypeName } from '../dialog';
import { loadVoiceFolderGenders } from '../web/voice/preview/speakerGender';
import type { FaceFxActorSex } from './faceFx/generateFfxanim';
import { DEFAULT_FACEFX_ACTOR } from './synthesizeVoicedWem';
import type { VoiceTakeFormat } from './takeFormat/types';

export type TakeSpeakerSexResolver = (speakerKey: string | null | undefined) => FaceFxActorSex;

/** The sex of a voice folder from stored genders (keyed by lower-cased folder) and its name. */
export const takeSpeakerSex = (
  storedByFolder: ReadonlyMap<string, FaceFxActorSex>,
  speakerKey: string | null | undefined,
): FaceFxActorSex => {
  const folder = speakerKey?.trim() ?? '';
  if (!folder) return DEFAULT_FACEFX_ACTOR;
  const stored = storedByFolder.get(folder.toLowerCase());
  if (stored) return stored;
  const fromName = resolveGenderFromVoiceTypeName(folder);
  return isDefiniteGender(fromName) ? fromName : DEFAULT_FACEFX_ACTOR;
};

/**
 * A resolver for one mod, or undefined when the take format has no use for it —
 * so a `.fuz` title makes no query here.
 */
export const loadTakeSpeakerSexResolver = async (
  db: Tx,
  modId: number,
  takes: Pick<VoiceTakeFormat, 'needsSpeakerSex'>,
): Promise<TakeSpeakerSexResolver | undefined> => {
  if (!takes.needsSpeakerSex) return undefined;
  const stored = new Map<string, FaceFxActorSex>();
  // Folder names differ in case between a VTYP EditorID and an extracted archive.
  for (const [folder, known] of await loadVoiceFolderGenders(db, modId)) {
    if (isDefiniteGender(known.gender)) stored.set(folder.toLowerCase(), known.gender);
  }
  return (speakerKey) => takeSpeakerSex(stored, speakerKey);
};
