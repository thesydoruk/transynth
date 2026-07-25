/**
 * Gender inference from Bethesda voice type and voice folder names.
 *
 * Every Creation Engine game names voice types after the gender of the actors
 * recorded for them (`MaleEvenToned`, `FemaleBoston`, `NPCFPiper`), and mods
 * inherit that convention because the Creation Kit exports voice assets into
 * folders named after the voice type. That makes the name a reliable fallback
 * for NPCs whose NPC_ record lives in a master the importer never reads.
 */
import type { SpeakerGender } from './gender';

/** `PlayerVoiceMale01`, `Player Voice Female 02` — the player character. */
const PLAYER_VOICE_RE = /^player[\s_-]*voice/i;

/**
 * `NPCFPiper`, `NPCMDanse` — Creation Kit marker for named companions.
 *
 * Not anchored: add-ons prefix it with the plugin they ship in, as in
 * `DLC04NPCMGage` and `DLC01NPCFMechanist`.
 */
const NPC_GENDER_MARKER_RE = /npc[\s_-]*([fm])[a-z]/i;

/** `female` anywhere in the name; checked first because "female" contains "male". */
const FEMALE_RE = /female|woman|girl/i;

/** `male` not preceded by `fe`. */
const MALE_RE = /(?<!fe)male/i;

/**
 * True when the voice type belongs to the player character rather than an NPC.
 *
 * The player's gender is a runtime choice, so their lines must read correctly
 * for both and are never assigned a concrete gender.
 */
export const isPlayerVoiceType = (name: string): boolean => PLAYER_VOICE_RE.test(name.trim());

/**
 * Infer a speaker gender from a voice type or voice folder name.
 *
 * @returns `unknown` when the name carries no gender hint (robots, turrets,
 * mod-specific names such as `DP_StellaVoice`).
 */
export const genderFromVoiceTypeName = (name: string | null | undefined): SpeakerGender => {
  const trimmed = name?.trim();
  if (!trimmed) return 'unknown';
  if (isPlayerVoiceType(trimmed)) return 'any';

  // The spelled-out word wins over the marker letter: an unanchored marker can
  // also match inside a longer word, as in `FemaleNPCMisc`.
  if (FEMALE_RE.test(trimmed)) return 'female';

  const marker = NPC_GENDER_MARKER_RE.exec(trimmed);
  if (marker) return marker[1]!.toLowerCase() === 'f' ? 'female' : 'male';

  if (MALE_RE.test(trimmed)) return 'male';

  return 'unknown';
};
