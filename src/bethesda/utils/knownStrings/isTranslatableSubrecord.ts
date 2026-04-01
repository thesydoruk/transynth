import type { GameType } from '../../../types';
import { getTranslatableSubrecords } from './getTranslatableSubrecords';

/**
 * Returns true if this subrecord/record combination is translatable for the given game.
 */
export const isTranslatableSubrecord = (
  recSig: string,
  subSig: string,
  game: GameType,
): boolean => getTranslatableSubrecords(game)[recSig]?.has(subSig) ?? false;
