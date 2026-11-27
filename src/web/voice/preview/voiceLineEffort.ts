/**
 * Vocal effort as the voice editor shows it: the tag of each line, and whether
 * the mod's game tags lines at all.
 *
 * Read outside the cached voice catalog: a person changes a line's tag from the
 * editor and the worker rewrites tags when it analyzes the mod, and neither
 * touches the stamps the catalog cache is keyed by.
 */
import type { Tx } from '../../../db';
import { DEFAULT_GAME_ID, gamePlugin } from '../../../games/registry';
import {
  effectiveEffortTag,
  saveEffortTagOverride,
  type ClipEffortState,
  type ClipEffortTake,
  type EffortTagOverride,
} from '../../../voice/voiceEffortStore';
import { effortTagsSwitchedOn } from '../../../voice/voiceEffortTags';
import type { EffortTag } from '../../../voice/vocalEffort';
import type { VoiceLinePreview } from './types';

export type VoiceLineEffort = Pick<
  VoiceLinePreview,
  'effortTag' | 'effortAutoTag' | 'effortOverride' | 'effortStrength'
>;

/** What the regenerate review and the editor menu offer: the derived tag, or a person's choice. */
export type VoiceEffortChoice = 'auto' | EffortTagOverride;

const CHOICES: readonly VoiceEffortChoice[] = ['auto', 'none', 'loud', 'shouting'];

/** A choice read from a request body; null when the value is not one. */
export const parseVoiceEffortChoice = (value: unknown): VoiceEffortChoice | null =>
  CHOICES.includes(value as VoiceEffortChoice) ? (value as VoiceEffortChoice) : null;

/** The `tag_override` a choice stores: "auto" clears it. */
export const effortOverrideOfChoice = (choice: VoiceEffortChoice): EffortTagOverride | null =>
  choice === 'auto' ? null : choice;

/** The tag a take is synthesized with under a choice, given its derived tag. */
export const effortTagOfChoice = (
  choice: VoiceEffortChoice,
  autoTag: EffortTag | null,
): EffortTag | null => effectiveEffortTag(autoTag, effortOverrideOfChoice(choice));

export const voiceLineEffortOf = (state: ClipEffortState | null | undefined): VoiceLineEffort => ({
  effortTag: state ? effectiveEffortTag(state.tag, state.override) : null,
  effortAutoTag: state?.tag ?? null,
  effortOverride: state?.override ?? null,
  effortStrength: state?.strength ?? null,
});

export type VoiceEffortTagsState = {
  /** The game's plugin reads the line directions tagging is planned from. */
  supported: boolean;
  /** Supported and switched on for the game, so tags reach synthesis. */
  active: boolean;
};

/** Whether a game tags lines, and whether it does so now. */
export const voiceEffortTagsStateFor = async (
  db: Tx,
  game: string | null | undefined,
): Promise<VoiceEffortTagsState> => {
  const supported = Boolean(gamePlugin(game ?? DEFAULT_GAME_ID).voice?.loadLineDirections);
  return { supported, active: supported && (await effortTagsSwitchedOn(db, game)) };
};

/** The mod's game as the voice catalog reads it; null when the mod does not exist. */
export const loadVoiceModGame = async (db: Tx, modId: number): Promise<string | null> => {
  const { rows } = await db.query<{ game: string | null }>(`SELECT game FROM mods WHERE id = $1`, [
    modId,
  ]);
  if (!rows[0]) return null;
  return rows[0].game ?? DEFAULT_GAME_ID;
};

export type VoiceLineEffortChoiceResult =
  | ({ ok: true } & VoiceLineEffort)
  | { ok: false; reason: 'mod_not_found' | 'effort_tags_unsupported'; message: string };

/**
 * Store a person's tag choice for one line. Allowed while the game's switch is off
 * too: the choice waits for it. Takes made before go stale only once tags are on,
 * through their version stamps, like any other change of tag.
 */
export const setVoiceLineEffortChoice = async (
  db: Tx,
  modId: number,
  take: ClipEffortTake,
  choice: VoiceEffortChoice,
): Promise<VoiceLineEffortChoiceResult> => {
  const game = await loadVoiceModGame(db, modId);
  if (game == null) return { ok: false, reason: 'mod_not_found', message: 'Mod not found' };
  if (!(await voiceEffortTagsStateFor(db, game)).supported) {
    return {
      ok: false,
      reason: 'effort_tags_unsupported',
      message: 'This game does not tag lines for vocal effort',
    };
  }
  const state = await saveEffortTagOverride(db, modId, take, effortOverrideOfChoice(choice));
  return { ok: true, ...voiceLineEffortOf(state) };
};
