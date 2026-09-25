import { isNarratorGenderTrusted } from '../../../../../src/dialog/narratorGender';
import { gamePlugin } from '../../../../../src/games/registry';
import type { VerifyStringRow } from './types';

/**
 * Whether a gender the detector found on this row counts as proof.
 *
 * On a spoken line the participants come from the game's own dialogue data
 * and a leak is a fact. On a terminal entry or a book nobody recorded an
 * author, so the gender was inferred — and a wrong inference does more than
 * block a correct line: it invites the repair pass to rewrite it into a wrong
 * one (observed: «Я вирішила розробити…» → «Я вирішив…»). Narration therefore
 * counts only when a person set the gender.
 */
export const isGenderLeakProvenForRow = (
  row: Pick<VerifyStringRow, 'narrator_gender_source' | 'narrator_gender_override'>,
  grup: string | null,
  game?: string | null,
): boolean =>
  (gamePlugin(game).dialog?.isSpokenSignature(grup) ?? false) ||
  isNarratorGenderTrusted(row.narrator_gender_source, row.narrator_gender_override);
