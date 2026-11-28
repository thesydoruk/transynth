import type { EffortZScores } from './baseline';

/**
 * Decide whether a line was shouted in the original, and which Fish Speech S2
 * tag says so.
 *
 * The rule is two gates, set on 160 hand-labelled Fallout 4 lines (shout /
 * raised voice / calm, five voice types):
 *
 *   1. The clip must sound pushed — pitch and brightness both well above the
 *      speaker's calm lines. The weaker of the two is the strength: either one
 *      alone is common in calm speech (a short "Here." rides high in pitch).
 *   2. For `shouting` the line must also say so — a `!` in the text or a
 *      shout in the actor note. Of 20 labelled lines passing both gates, 14
 *      were shouts, 6 a raised voice and none calm; without the second gate a
 *      fifth of the lines at that strength were calm.
 *
 * A pushed clip with no such cue is `loud`, from a higher strength (5 of 6
 * labelled were a raised voice). A combat topic and the facial emotion decide
 * nothing here: labelled combat lines without `!` were as often calm as
 * shouted, and angry or frightened faces mostly spoke in a raised voice.
 *
 * Without a clip there is no tag: the text alone marked 17 shouts, 26 raised
 * voices and 4 calm lines.
 */

/** Inline S2 control tags, weaker to stronger. */
export type EffortTag = 'loud' | 'shouting';

export type EffortSignals = {
  /** Clip against its speaker's calm baseline; omit when the clip could not be analyzed. */
  acoustic?: EffortZScores | null;
  /** Source-language line, stage directions already stripped. */
  sourceText?: string | null;
  /** Voice-actor direction from the dialogue record (Bethesda `NAM2`), if any. */
  scriptNote?: string | null;
};

export type EffortDecision = {
  /** The weaker of the pitch and brightness z-scores; null without a clip. */
  strength: number | null;
  /** The text or the actor note says the line is shouted. */
  cued: boolean;
  tag: EffortTag | null;
};

/** Strength a cued line needs to be tagged `shouting`. */
const SHOUT_STRENGTH = 2;
/** Strength an uncued line needs to be tagged `loud`. */
const LOUD_STRENGTH = 2.5;

const NOTE_SHOUT_RE = /\b(shout\w*|yell\w*|scream\w*|holler\w*|bellow\w*|roar\w*)\b/i;

/**
 * Does the line itself say it is shouted — a `!` in its text or a shout in the
 * actor note? Also what keeps a line out of a speaker's calm baseline: a
 * raider's scene line "Everybody up! We got trouble!" is a calm topic and not
 * a calm clip.
 */
export const hasEffortCue = (signals: Pick<EffortSignals, 'sourceText' | 'scriptNote'>): boolean =>
  (signals.sourceText ?? '').includes('!') || NOTE_SHOUT_RE.test(signals.scriptNote ?? '');

/**
 * @example
 * decideVocalEffort({ acoustic: { f0Median: 3, brightness: 2.4 }, sourceText: 'Get down!' }).tag;
 * // 'shouting'
 * decideVocalEffort({ sourceText: 'Get down!' }).tag; // null — no clip to hear
 */
export const decideVocalEffort = (signals: EffortSignals): EffortDecision => {
  const cued = hasEffortCue(signals);
  const { acoustic } = signals;
  if (!acoustic) return { strength: null, cued, tag: null };

  const strength = Math.min(acoustic.f0Median, acoustic.brightness);
  let tag: EffortTag | null = null;
  if (cued && strength >= SHOUT_STRENGTH) tag = 'shouting';
  else if (strength >= LOUD_STRENGTH) tag = 'loud';

  return { strength, cued, tag };
};

/**
 * Prefix TTS text with the tag. Call this after the game's own `[...]` blocks
 * are stripped — `stripVoiceNonSpeechBlocks` would remove the tag otherwise.
 *
 * @example applyEffortTag('Лягай!', 'shouting') // '[shouting] Лягай!'
 */
export const applyEffortTag = (text: string, tag: EffortTag | null): string =>
  tag ? `[${tag}] ${text.trim()}` : text;
