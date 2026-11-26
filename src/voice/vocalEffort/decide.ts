import type { EffortZScores } from './baseline';

/**
 * Decide whether a line was shouted in the original, and which Fish Speech S2
 * tag says so.
 *
 * Game text carries no usable markup for this, so the decision is a weighted
 * sum of independent hints. Every weight and threshold below is a first guess:
 * tune them against takes you have listened to (`npm run voice:scan-effort`)
 * before any of this reaches synthesis.
 */

/** Inline S2 control tags, weakest to strongest. */
export type EffortTag = 'loud' | 'shouting' | 'screaming';

export type EffortSignals = {
  /** Clip against its speaker's baseline; omit when the clip could not be analyzed. */
  acoustic?: EffortZScores | null;
  /** Source-language line, stage directions already stripped. */
  sourceText?: string | null;
  /** Voice-actor direction from the dialogue record (Bethesda `NAM2`), if any. */
  scriptNote?: string | null;
  /** The line belongs to a combat bark topic (attack, hit, flee, taunt, …). */
  combatBark?: boolean;
  /** Facial-emotion class of the response, if the record names one. */
  emotion?: 'anger' | 'fear' | 'pain' | 'other' | null;
};

export type EffortDecision = {
  score: number;
  tag: EffortTag | null;
  /** Contribution of each hint, for the calibration listing. */
  parts: { acoustic: number; text: number; note: number; context: number };
};

const LOUD_THRESHOLD = 1.2;
const SHOUT_THRESHOLD = 2;
const SCREAM_THRESHOLD = 3.5;

const NOTE_SHOUT_RE = /\b(shout\w*|yell\w*|scream\w*|holler\w*|bellow\w*|roar\w*)\b/i;
const NOTE_SCREAM_RE = /\b(scream\w*|shriek\w*|terrified|agony|panick?\w*)\b/i;
const NOTE_HEATED_RE =
  /\b(angr\w+|furious|enraged|rage|loud\w*|calling out|over (the )?gunfire)\b/i;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Pitch and brightness together; either alone is too easy to trigger by accident. */
const acousticScore = (acoustic: EffortZScores | null | undefined): number => {
  if (!acoustic) return 0;
  const pitch = Math.max(acoustic.f0Median, acoustic.f0P90 * 0.8);
  return clamp(0.6 * pitch + 0.6 * acoustic.brightness, -1, 3);
};

const textScore = (sourceText: string | null | undefined): number => {
  const text = sourceText?.trim() ?? '';
  if (!text.includes('!')) return 0;
  let score = 0.4;
  if (/!{2,}/.test(text) || /\b[A-Z]{3,}\b/.test(text)) score += 0.4;
  if (text.split(/\s+/).length <= 4) score += 0.2;
  return score;
};

const noteScore = (scriptNote: string | null | undefined): number => {
  const note = scriptNote?.trim() ?? '';
  if (!note) return 0;
  if (NOTE_SHOUT_RE.test(note)) return 2.5;
  return NOTE_HEATED_RE.test(note) ? 1 : 0;
};

const contextScore = (signals: EffortSignals): number => {
  let score = signals.combatBark ? 2 : 0;
  if (signals.emotion && signals.emotion !== 'other') score += 0.75;
  return score;
};

const wantsScream = (signals: EffortSignals): boolean =>
  signals.emotion === 'fear' ||
  signals.emotion === 'pain' ||
  NOTE_SCREAM_RE.test(signals.scriptNote ?? '');

/**
 * @example
 * decideVocalEffort({ combatBark: true, sourceText: 'Get down!' }).tag; // 'shouting'
 * decideVocalEffort({ sourceText: 'Nice weather.' }).tag;               // null
 */
export const decideVocalEffort = (signals: EffortSignals): EffortDecision => {
  const parts = {
    acoustic: acousticScore(signals.acoustic),
    text: textScore(signals.sourceText),
    note: noteScore(signals.scriptNote),
    context: contextScore(signals),
  };
  const score = parts.acoustic + parts.text + parts.note + parts.context;

  let tag: EffortTag | null = null;
  if (score >= SCREAM_THRESHOLD && wantsScream(signals)) tag = 'screaming';
  else if (score >= SHOUT_THRESHOLD) tag = 'shouting';
  else if (score >= LOUD_THRESHOLD) tag = 'loud';

  return { score, tag, parts };
};

/**
 * Prefix TTS text with the tag. Call this after the game's own `[...]` blocks
 * are stripped — `stripVoiceNonSpeechBlocks` would remove the tag otherwise.
 *
 * @example applyEffortTag('Лягай!', 'shouting') // '[shouting] Лягай!'
 */
export const applyEffortTag = (text: string, tag: EffortTag | null): string =>
  tag ? `[${tag}] ${text.trim()}` : text;
