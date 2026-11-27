/**
 * The effort tags synthesis actually uses for a mod.
 *
 * Tags are stored for every analyzed mod (`voiceEffortStore`), but they reach
 * the TTS text only for a game that has them switched on (Settings → Voice,
 * `voice.game_tts`). Everything that prepares TTS text or stamps a take asks
 * here, so a game with tags off behaves exactly as it did before they existed.
 */
import type { Tx } from '../db';
import { getAllProjectSettings } from '../web/services/projectSettings';
import { gameTtsMatchFor } from './gameTtsSettings';
import type { EffortTag } from './vocalEffort';
import { loadVoiceEffortTags } from './voiceEffortStore';
import { voiceSynthesisStateKey } from './voiceSynthesisState';

export type VoiceEffortTagMap = ReadonlyMap<string, EffortTag>;

const NO_TAGS: VoiceEffortTagMap = new Map();

/** Whether the game has effort tags switched on in Settings → Voice. */
export const effortTagsSwitchedOn = async (
  db: Tx,
  game: string | null | undefined,
): Promise<boolean> => {
  const settings = await getAllProjectSettings(db);
  return gameTtsMatchFor(settings['voice.game_tts'], game).effortTags;
};

/** Tags of the mod's takes; empty when the game has effort tags switched off. */
export const loadActiveVoiceEffortTags = async (
  db: Tx,
  modId: number,
  game: string | null | undefined,
): Promise<VoiceEffortTagMap> => {
  if (!(await effortTagsSwitchedOn(db, game))) return NO_TAGS;
  return loadVoiceEffortTags(db, modId);
};

/** The tag of one take, or null. */
export const lookupVoiceEffortTag = (
  tags: VoiceEffortTagMap,
  speakerKey: string | null | undefined,
  lineKey: string,
  variant: number,
  origin?: string | null,
): EffortTag | null =>
  tags.get(voiceSynthesisStateKey(speakerKey, lineKey, variant, origin)) ?? null;
