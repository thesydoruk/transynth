import path from 'node:path';
import { PATHS } from '../../paths';

/** Stop auto-select after the first clip scoring at or above this (lazy search). */
export const AUTO_SELECT_GOOD_ENOUGH_SCORE = 5;

export const MANUAL_REFERENCE_NAME = '_reference.wav';

export const speakerReferenceCacheRoot = (modId: number): string =>
  path.join(PATHS.voicePreview, String(modId), 'speaker-ref');

export const entryReferenceCacheRoot = (modId: number): string =>
  path.join(PATHS.voicePreview, String(modId), 'entry-ref');
