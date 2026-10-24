/**
 * Check an editor's fixes against the batch they were made for, before any of
 * them reaches the database. A rejected fix goes back to the editor with the
 * reason; nothing here guesses a correction.
 */
import type { GameId } from '../types';
import { compareProtectedTokens } from '../utils/placeholders';
import type { ReviewBatch, ReviewFix, ReviewFixFile, ReviewLine } from './types';

export type CheckedFixes = {
  batch_id: string;
  ok: ReviewFix[];
  rejected: { fix: ReviewFix; why: string[] }[];
  notes: string[];
};

/** "зробив/ла", "готовий/а", "обережним/ою": a word with a gender ending after a slash. */
const SLASH_GENDER_RE = /[а-яіїєґʼ']{2,}\/(?:ла|на|а|я|ий|ою|ої|ім|им|ій)(?![а-яіїєґ])/iu;
const LATIN_WORD_RE = /[A-Za-z]{3,}/g;
/** A remark at the start of a line, or a one-word tone prompt: "[Sarcasm] …", "Sarcastic". */
const REMARK_SOURCE_RE = /^\s*\[[A-Za-z][A-Za-z ]*\]|^[A-Z][a-z]+\.?\s*$/;
const LENGTH_RATIO_MIN = 0.3;
const LENGTH_RATIO_MAX = 2.6;
const SHORT_SOURCE = 25;

const latinWords = (s: string) => (s.match(LATIN_WORD_RE) ?? []).map((w) => w.toLowerCase());

const tokensKept = (line: ReviewLine, next: string, game: GameId | null) => {
  const context = {
    grup: line.sig ?? (line.kind === 'response' || line.kind === 'prompt' ? 'INFO' : null),
    field: line.field ?? null,
  };
  return (
    compareProtectedTokens(line.src, next, game, context).ok ||
    compareProtectedTokens(line.tr, next, game, context).ok
  );
};

/** Reasons a fix must not be applied; empty when it may. */
export const fixProblems = (
  line: ReviewLine | undefined,
  fix: ReviewFix,
  game: GameId | null,
): string[] => {
  if (!line) return ['unknown id'];
  const why: string[] = [];
  if (line.context_only) why.push('context_only line');
  if (typeof fix.new !== 'string' || !fix.new.trim()) return [...why, 'empty new'];
  if (fix.old !== line.tr) why.push('old does not match the current translation');
  if (fix.new === line.tr) why.push('new equals old');
  if (!tokensKept(line, fix.new, game)) why.push('tags or placeholders changed');
  if (SLASH_GENDER_RE.test(fix.new)) why.push('slash gender form');
  if (!/[а-яіїєґ]/i.test(fix.new) && /[а-яіїєґ]/i.test(line.tr)) why.push('no Cyrillic left');

  const known = [...latinWords(line.src), ...latinWords(line.tr)];
  const stray = latinWords(fix.new).filter(
    (w) => !known.some((k) => k.startsWith(w) || w.startsWith(k)),
  );
  if (stray.length) why.push(`unexpected Latin: ${[...new Set(stray)].slice(0, 4).join(', ')}`);

  const ratio = fix.new.length / Math.max(1, line.src.length);
  if (line.src.length > SHORT_SOURCE && (ratio > LENGTH_RATIO_MAX || ratio < LENGTH_RATIO_MIN)) {
    why.push(`length ratio ${ratio.toFixed(2)}`);
  }
  if (REMARK_SOURCE_RE.test(line.src) && /^\s*\[/.test(line.tr) && !/^\s*\[/.test(fix.new)) {
    why.push('the remark keeps its brackets');
  }
  if (/\?\s*$/.test(line.src) && line.src.length < 60 && !/[?.!…]\s*["»]?\s*$/.test(fix.new)) {
    why.push('question mark lost');
  }
  return why;
};

export const validateFixes = (
  batch: ReviewBatch,
  file: ReviewFixFile,
  game: GameId | null,
): CheckedFixes => {
  const lines = new Map(batch.units.flatMap((u) => u.lines.map((l) => [l.id, l] as const)));
  const seen = new Set<number>();
  const out: CheckedFixes = {
    batch_id: batch.batch_id,
    ok: [],
    rejected: [],
    notes: file.notes ?? [],
  };
  for (const fix of file.fixes ?? []) {
    const why = fixProblems(lines.get(fix.id), fix, game);
    if (seen.has(fix.id)) why.push('duplicate id');
    seen.add(fix.id);
    if (why.length) out.rejected.push({ fix, why });
    else out.ok.push(fix);
  }
  return out;
};
