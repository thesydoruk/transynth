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
const FEMALE_RE = /female|woman|girl|queen|matriarch/i;

/** `male` not preceded by `fe`. */
const MALE_RE = /(?<!fe)male/i;

/** Creation Kit creature voices: CrFeralGhoul, CrDeathclaw. */
const CREATURE_VOICE_RE = /^cr[a-z0-9]/i;

/** Robot voices: RobotMrHandy, DLC01RobotRobobrain. */
const ROBOT_VOICE_RE = /robot/i;

/** Turret and similar automated defenses. */
const TURRET_VOICE_RE = /turret|protectron|assaultron|mr\.?\s*handy|gutsy|securitron/i;

/** Common animal/monster folders that omit the Cr prefix. */
const MONSTER_VOICE_RE =
  /(?:^|_)(?:dog|canine|mole|radrat|radroach|bloatfly|bloodbug|stingwing|yaug|deathclaw|ghoul|mutant)(?:[a-z]|$)/i;

/**
 * True when the voice type belongs to the player character rather than an NPC.
 *
 * The player's gender is a runtime choice, so their lines must read correctly
 * for both and are never assigned a concrete gender.
 */
export const isPlayerVoiceType = (name: string): boolean => PLAYER_VOICE_RE.test(name.trim());

/**
 * Infer a speaker gender from explicit markers in a voice type or folder name.
 *
 * Deliberately silent on robots and creatures: those are handled by
 * {@link genderFromVoiceTypeHeuristic} only after the VTYP DNAM flag is missing,
 * so a flagged female robot such as PAM is not overridden.
 */
export const genderFromVoiceTypeName = (name: string | null | undefined): SpeakerGender => {
  const trimmed = name?.trim();
  if (!trimmed) return 'unknown';
  if (isPlayerVoiceType(trimmed)) return 'any';

  if (FEMALE_RE.test(trimmed)) return 'female';

  const marker = NPC_GENDER_MARKER_RE.exec(trimmed);
  if (marker) return marker[1]!.toLowerCase() === 'f' ? 'female' : 'male';

  if (MALE_RE.test(trimmed)) return 'male';

  return 'unknown';
};

/**
 * Last-resort gender from Creation Kit voice folder naming patterns.
 *
 * Non-human speakers default to masculine Ukrainian agreement when nothing
 * else in the plugin names their sex — the usual choice for robots,
 * ghouls, and other monsters in game localization.
 */
export const genderFromVoiceTypeHeuristic = (name: string | null | undefined): SpeakerGender => {
  const trimmed = name?.trim();
  if (!trimmed) return 'unknown';
  if (isPlayerVoiceType(trimmed)) return 'any';

  if (
    CREATURE_VOICE_RE.test(trimmed) ||
    ROBOT_VOICE_RE.test(trimmed) ||
    TURRET_VOICE_RE.test(trimmed) ||
    MONSTER_VOICE_RE.test(trimmed)
  ) {
    return 'male';
  }

  return 'unknown';
};

/** Explicit name markers first, then creature/robot heuristics. */
export const resolveGenderFromVoiceTypeName = (name: string | null | undefined): SpeakerGender => {
  const explicit = genderFromVoiceTypeName(name);
  return explicit !== 'unknown' ? explicit : genderFromVoiceTypeHeuristic(name);
};
