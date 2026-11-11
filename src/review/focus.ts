/**
 * Which lines of a batch an editor works on. A plain review takes every
 * translated line; a focused run takes only some — lines nobody translated yet
 * (`untranslated`), or lines one pass wrote (`provenances`) — and shows the
 * rest of the scene as context, trimmed to a few neighbours around the work.
 */
import type { ReviewLine, ReviewUnit } from './types';

export type ReviewFocus = {
  /** Work on lines without a translation; translated lines become context. */
  untranslated?: boolean;
  /** Work only on lines whose translation has one of these provenances. */
  provenances?: ReadonlySet<string>;
};

/** Context lines kept on each side of a run of work lines. */
const FOCUS_NEIGHBOURS = 4;

const hasLetters = (text: string) => /[A-Za-z]/.test(text);

export const isFocused = (focus: ReviewFocus | undefined): boolean =>
  Boolean(focus?.untranslated || (focus?.provenances && focus.provenances.size > 0));

/** True when a line is work under the focus (always true without one). */
export const isFocusTarget = (
  focus: ReviewFocus | undefined,
  line: { translation: string | null; provenance: string | null; source: string },
): boolean => {
  if (!isFocused(focus)) return true;
  if (focus!.untranslated) return !line.translation && hasLetters(line.source);
  return line.translation != null && focus!.provenances!.has(line.provenance ?? '');
};

/**
 * Drop units with no work in them and trim the rest to the work lines plus
 * a few neighbours, so a one-line gap in a long scene is not a whole batch.
 */
export const focusUnits = (units: readonly ReviewUnit[]): ReviewUnit[] =>
  units.flatMap((unit) => {
    const work = unit.lines.map((l) => !l.context_only);
    if (!work.some(Boolean)) return [];
    const keep = (i: number) =>
      work.slice(Math.max(0, i - FOCUS_NEIGHBOURS), i + FOCUS_NEIGHBOURS + 1).some(Boolean);
    const lines: ReviewLine[] = unit.lines.filter((_, i) => keep(i));
    return [{ ...unit, lines }];
  });
