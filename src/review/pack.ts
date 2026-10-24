/**
 * Cut review units into batches an editor can read in one sitting.
 *
 * Sizes are what the 2026-10-21 Fallout 4 review settled on: a dialogue batch
 * of ~110 lines is a few scenes read as conversations; prose is capped by
 * characters because one terminal can be a page long.
 */
import type { LlmPromptFamily } from '../llm/promptFamily';
import type { ReviewLine, ReviewUnit } from './types';

type Size = { target: number; hard: number; neighbours: number };

const SIZES: Record<LlmPromptFamily, Size> = {
  dialog: { target: 110, hard: 150, neighbours: 6 },
  prose: { target: 60, hard: 90, neighbours: 3 },
  quest: { target: 120, hard: 160, neighbours: 3 },
  item: { target: 220, hard: 280, neighbours: 3 },
  mcm: { target: 180, hard: 240, neighbours: 3 },
  face: { target: 220, hard: 280, neighbours: 3 },
  default: { target: 120, hard: 160, neighbours: 3 },
};

/** Source characters per batch, whatever the family. */
export const BATCH_CHAR_CAP = 14_000;

const chars = (lines: readonly ReviewLine[]) => lines.reduce((n, l) => n + l.src.length, 0);

/**
 * Split a unit too long for one batch into windows of `target` lines, each
 * with a few neighbours on both sides marked `context_only`.
 */
export const windowUnit = (unit: ReviewUnit, family: LlmPromptFamily): ReviewUnit[] => {
  const { target, neighbours } = SIZES[family];
  const lines = unit.lines;
  if (lines.length <= Math.round(target * 1.35)) return [unit];
  const out: ReviewUnit[] = [];
  for (let start = 0; start < lines.length; start += target) {
    const from = Math.max(0, start - neighbours);
    const to = Math.min(lines.length, start + target + neighbours);
    const windowLines = lines.slice(from, to).map((line, k) => {
      const index = from + k;
      return index >= start && index < start + target
        ? line
        : { ...line, context_only: true as const };
    });
    out.push({ ...unit, unit_id: `${unit.unit_id}#${out.length + 1}`, lines: windowLines });
  }
  return out;
};

/** Group consecutive units into batches without splitting a unit. */
export const packUnits = (
  units: readonly ReviewUnit[],
  family: LlmPromptFamily,
): ReviewUnit[][] => {
  const { target, hard } = SIZES[family];
  const batches: ReviewUnit[][] = [];
  let current: ReviewUnit[] = [];
  let lineCount = 0;
  let charCount = 0;
  for (const unit of units.flatMap((u) => windowUnit(u, family))) {
    const n = unit.lines.length;
    const c = chars(unit.lines);
    if (
      current.length > 0 &&
      (lineCount + n > hard || charCount + c > BATCH_CHAR_CAP || lineCount >= target)
    ) {
      batches.push(current);
      current = [];
      lineCount = 0;
      charCount = 0;
    }
    current.push(unit);
    lineCount += n;
    charCount += c;
  }
  if (current.length > 0) batches.push(current);
  return batches;
};

/** Lines an editor is asked to review (not context). */
export const reviewLineCount = (units: readonly ReviewUnit[]): number =>
  units.reduce((n, u) => n + u.lines.filter((l) => !l.context_only).length, 0);
