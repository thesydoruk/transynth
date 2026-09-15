/**
 * Scoring a body of translations against the checks that can be made without
 * a human.
 *
 * Prompt work is unfalsifiable without a number to move: every change reads
 * like an improvement to whoever wrote it. These are the defects a machine can
 * be sure about — a gender the metadata rules out, an English construction
 * that survived, a placeholder that did not — counted over a fixed corpus so
 * two prompt versions can be compared on the same lines.
 *
 * What it does not measure is whether the line is *good*. A translation can be
 * clean on every count here and still be flat. Treat a falling defect rate as
 * necessary, not sufficient.
 */
import { gamePlugin } from '../../games/registry';
import {
  describeUkrainianCalques,
  findUkrainianCalques,
  findUkrainianGenderConflicts,
  parseSpeakerGender,
  type SpeakerGender,
} from '../../dialog';
import { compareProtectedTokens } from '../../utils/placeholders';
import type { GameId } from '../../types';

/** One translated line to score. */
export type EvalLine = {
  id: string | number;
  source: string;
  translation: string;
  grup?: string | null;
  field?: string | null;
  speakerGender?: string | null;
  addresseeGender?: string | null;
  game?: GameId | null;
};

/** Why one line failed. */
export type EvalDefect = {
  id: string | number;
  kind: 'gender' | 'calque' | 'placeholder';
  detail: string;
};

/**
 * Which slice of the corpus a line belongs to.
 *
 * The slices are the cases that behave differently, not a taxonomy: a line
 * whose speaker the player chooses is a different problem from a line spoken
 * by a named NPC, and mixing them hides which one moved.
 */
export type EvalBucket =
  | 'player_speaks'
  | 'player_addressed'
  | 'known_gender'
  | 'unknown_gender'
  | 'not_dialogue';

export type EvalBucketReport = {
  lines: number;
  defects: number;
  /** Share of lines with at least one defect, 0–1. */
  rate: number;
};

export type EvalReport = {
  lines: number;
  defects: EvalDefect[];
  byKind: Record<EvalDefect['kind'], number>;
  byBucket: Record<EvalBucket, EvalBucketReport>;
};

const isDefinite = (gender: SpeakerGender): boolean => gender === 'male' || gender === 'female';

export const bucketOf = (line: EvalLine): EvalBucket => {
  const spoken = gamePlugin(line.game).dialog?.isSpokenSignature(line.grup) ?? false;
  if (!spoken) return 'not_dialogue';
  const speaker = parseSpeakerGender(line.speakerGender);
  const addressee = parseSpeakerGender(line.addresseeGender);
  if (speaker === 'any') return 'player_speaks';
  if (addressee === 'any') return 'player_addressed';
  if (isDefinite(speaker) || isDefinite(addressee)) return 'known_gender';
  return 'unknown_gender';
};

/** Every machine-checkable defect of one line. */
export const findLineDefects = (line: EvalLine): EvalDefect[] => {
  const defects: EvalDefect[] = [];

  const conflicts = findUkrainianGenderConflicts(line.translation, {
    speakerGender: parseSpeakerGender(line.speakerGender),
    addresseeGender: parseSpeakerGender(line.addresseeGender),
  });
  for (const conflict of conflicts) {
    defects.push({
      id: line.id,
      kind: 'gender',
      detail: `${conflict.role}: «${conflict.form}» is ${conflict.found}, expected ${conflict.expected}`,
    });
  }

  const calques = findUkrainianCalques(line.translation);
  if (calques.length > 0) {
    defects.push({ id: line.id, kind: 'calque', detail: describeUkrainianCalques(calques) });
  }

  const tokens = compareProtectedTokens(line.source, line.translation, line.game ?? undefined, {
    grup: line.grup,
    field: line.field,
  });
  if (!tokens.ok) {
    defects.push({ id: line.id, kind: 'placeholder', detail: tokens.message });
  }

  return defects;
};

const emptyBucket = (): EvalBucketReport => ({ lines: 0, defects: 0, rate: 0 });

/** Score a corpus, bucketed by the kind of gender problem each line poses. */
export const buildEvalReport = (lines: readonly EvalLine[]): EvalReport => {
  const defects: EvalDefect[] = [];
  const byKind: Record<EvalDefect['kind'], number> = { gender: 0, calque: 0, placeholder: 0 };
  const byBucket: Record<EvalBucket, EvalBucketReport> = {
    player_speaks: emptyBucket(),
    player_addressed: emptyBucket(),
    known_gender: emptyBucket(),
    unknown_gender: emptyBucket(),
    not_dialogue: emptyBucket(),
  };

  for (const line of lines) {
    const bucket = byBucket[bucketOf(line)];
    bucket.lines++;

    const lineDefects = findLineDefects(line);
    if (lineDefects.length > 0) bucket.defects++;
    for (const defect of lineDefects) {
      defects.push(defect);
      byKind[defect.kind]++;
    }
  }

  for (const bucket of Object.values(byBucket)) {
    bucket.rate = bucket.lines === 0 ? 0 : bucket.defects / bucket.lines;
  }

  return { lines: lines.length, defects, byKind, byBucket };
};

const pct = (value: number): string => `${(value * 100).toFixed(2)}%`;

/** Human-readable scorecard, optionally against an earlier run. */
export const formatEvalReport = (report: EvalReport, baseline?: EvalReport): string => {
  const lines: string[] = [];
  const delta = (now: number, before: number | undefined): string =>
    before == null
      ? ''
      : ` (${now - before >= 0 ? '+' : ''}${((now - before) * 100).toFixed(2)}pp)`;

  lines.push(`lines: ${report.lines}`);
  lines.push(
    `defects: ${report.defects.length}  ` +
      `gender=${report.byKind.gender} calque=${report.byKind.calque} placeholder=${report.byKind.placeholder}`,
  );
  lines.push('');
  lines.push('bucket                lines   defects   rate');

  for (const [name, bucket] of Object.entries(report.byBucket) as Array<
    [EvalBucket, EvalBucketReport]
  >) {
    lines.push(
      `${name.padEnd(20)} ${String(bucket.lines).padStart(6)}  ${String(bucket.defects).padStart(7)}   ` +
        `${pct(bucket.rate)}${delta(bucket.rate, baseline?.byBucket[name]?.rate)}`,
    );
  }

  return lines.join('\n');
};
