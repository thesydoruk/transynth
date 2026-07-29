import path from 'node:path';
import { PATHS } from '../../paths';

/** Stop auto-select after the first clip scoring at or above this (lazy search). */
export const AUTO_SELECT_GOOD_ENOUGH_SCORE = 5;

/**
 * Shortest clip usable as a TTS voice reference.
 *
 * The synthesis backend rejects shorter references with
 * `Reference audio too short (0.9s). At least 1s of clear speech is required.`
 * — it reports whole tenths, so the floor keeps a margin above its 1 s limit.
 */
export const MIN_REFERENCE_DURATION_SEC = 1.2;

/** Longest clip worth sending; longer references slow synthesis without gain. */
export const MAX_REFERENCE_DURATION_SEC = 14;

export const MANUAL_REFERENCE_NAME = '_reference.wav';

export const speakerReferenceCacheRoot = (modId: number): string =>
  path.join(PATHS.voicePreview, String(modId), 'speaker-ref');

export const entryReferenceCacheRoot = (modId: number): string =>
  path.join(PATHS.voicePreview, String(modId), 'entry-ref');
