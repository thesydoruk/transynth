import path from 'node:path';
import { PATHS } from '../../paths';

/** Quality-score threshold used in tests; auto-select now ranks by duration + tempo. */
export const AUTO_SELECT_GOOD_ENOUGH_SCORE = 5;

/**
 * Shortest clip usable as a TTS voice reference.
 *
 * The synthesis backend rejects shorter references with
 * `Reference audio too short (0.9s). At least 1s of clear speech is required.`
 * — it reports whole tenths, so the floor keeps a margin above its 1 s limit.
 */
export const MIN_REFERENCE_DURATION_SEC = 1.2;

/** Preferred speaker-reference length. */
export const PREFERRED_REFERENCE_DURATION_MIN_SEC = 8;
export const PREFERRED_REFERENCE_DURATION_MAX_SEC = 12;

/** Longest clip worth sending; longer references slow synthesis without gain. */
export const MAX_REFERENCE_DURATION_SEC = 14;

/** Target syllables per second of active speech (band 4–6). */
export const TARGET_SPEAKING_RATE_SYL_PER_SEC = 5;
export const MIN_SPEAKING_RATE_SYL_PER_SEC = 4;
export const MAX_SPEAKING_RATE_SYL_PER_SEC = 6;

export const MANUAL_REFERENCE_NAME = '_reference.wav';

export const speakerReferenceCacheRoot = (modId: number): string =>
  path.join(PATHS.voicePreview, String(modId), 'speaker-ref');

export const entryReferenceCacheRoot = (modId: number): string =>
  path.join(PATHS.voicePreview, String(modId), 'entry-ref');

/**
 * Auto-select decodes at most this many sibling takes per speaker, spread over
 * the pool; a player voice has ~13k takes and decoding them all stalled jobs.
 */
export const AUTO_SELECT_MAX_CANDIDATES = 240;

/** Stop the scan once this many 8–12 s in-tempo takes are ranked. */
export const AUTO_SELECT_PREFERRED_STOP_COUNT = 8;
