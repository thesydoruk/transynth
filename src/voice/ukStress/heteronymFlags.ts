import { applyStressMark } from 'ua-word-stress';
import { STRESS_COMBINING_ACUTE, stripStressMarks } from '../stressedTranslation';
import { restoreWordCase } from './placeLine';

const VOWELS = new Set([...'аеєиіїоуюяАЕЄИІЇОУЮЯ']);
const BOUND = String.raw`(?<![\p{L}\p{M}])`;
const BOUND_END = String.raw`(?![\p{L}\p{M}])`;

export const WORD_RE = /[\p{L}\p{M}]+(?:['\u2019\u02BC\u2018][\p{L}\p{M}]+)*/gu;

export type HeteronymFlag = {
  tokenIndex: number;
  plain: string;
  chosenIdx: number;
  correctIdx: number;
  chosen: string;
  correct: string;
  reason: string;
};

const has = (ctx: string, re: RegExp): boolean => re.test(ctx);

export const stressedVowelIndex = (word: string): number | null => {
  const chars = [...word.normalize('NFC')];
  let vi = 0;
  for (let i = 0; i < chars.length; i++) {
    if (!VOWELS.has(chars[i])) continue;
    if (chars[i + 1] === STRESS_COMBINING_ACUTE) return vi;
    vi += 1;
  }
  return null;
};

const pondCue = (ctx: string): boolean => {
  const t = ctx.toLocaleLowerCase('uk-UA');
  return (
    has(
      t,
      new RegExp(
        `${BOUND}(сяюч|лебед|лебід|вод|риб|пляж|берег|озер|річк|болот|купа|плив|човн|качур|качк|жаб|калюж)`,
        'u',
      ),
    ) ||
    has(t, new RegExp(`${BOUND}(у|в|на|по|через|до)${BOUND_END}\\s+[\\p{L}\\p{M}']*ставк`, 'u'))
  );
};

const castleCue = (ctx: string): boolean => {
  const t = ctx.toLocaleLowerCase('uk-UA');
  return has(
    t,
    new RegExp(
      `${BOUND}(старий|руїн|корол|принц|башт|фортец|пагорб|середньовіч|цитадел|бастіон)`,
      'u',
    ),
  );
};

const lockCue = (ctx: string): boolean => {
  const t = ctx.toLocaleLowerCase('uk-UA');
  return has(
    t,
    new RegExp(
      `${BOUND}(відчин|відкри|замкн|ключ|двер|скринь|защіпк|відмик|термінал|злам|аналіз|обійти|шпильк|складн)`,
      'u',
    ),
  );
};

const flourCue = (ctx: string): boolean => {
  const t = ctx.toLocaleLowerCase('uk-UA');
  return has(t, new RegExp(`${BOUND}(міш|печ|хліб|тісто|пшенич|жернов|міси)`, 'u'));
};

const tormentCue = (ctx: string): boolean => {
  const t = ctx.toLocaleLowerCase('uk-UA');
  return has(t, new RegExp(`${BOUND}(біль|страждан|пекл|душе|серц|звільн)`, 'u'));
};

const mealCue = (ctx: string): boolean => {
  const t = ctx.toLocaleLowerCase('uk-UA');
  return has(
    t,
    new RegExp(`${BOUND}(пропуст|їж|їст|вартов|тарілк|обід|прибув|на${BOUND_END}\\s+обід)`, 'u'),
  );
};

/** Decide if a heteronym token used the wrong reading; return the correct vowel index. */
export const correctHeteronymIndex = (
  plainLower: string,
  chosenIdx: number,
  stresses: readonly number[],
  context: string,
): { correctIdx: number; reason: string } | null => {
  if (/^ставк/u.test(plainLower) || plainLower === 'ставок') {
    const pondIdx = stresses.includes(1) ? 1 : stresses[stresses.length - 1]!;
    const betIdx = stresses.includes(0) ? 0 : stresses[0]!;
    if (pondCue(context) && chosenIdx === betIdx && chosenIdx !== pondIdx) {
      return { correctIdx: pondIdx, reason: 'ставок(водойма) vs ставка' };
    }
  }
  if (/^замк/u.test(plainLower)) {
    if (lockCue(context) && chosenIdx === 0 && stresses.includes(1)) {
      return { correctIdx: 1, reason: 'замок: механізм/ключ' };
    }
    if (castleCue(context) && chosenIdx === 1 && stresses.includes(0)) {
      return { correctIdx: 0, reason: 'замок: фортеця' };
    }
  }
  if (/^мук/u.test(plainLower)) {
    if (flourCue(context) && chosenIdx === 0 && stresses.includes(1)) {
      return { correctIdx: 1, reason: 'мука: борошно' };
    }
    if (tormentCue(context) && chosenIdx === 1 && stresses.includes(0)) {
      return { correctIdx: 0, reason: 'мука: страждання' };
    }
  }
  if (plainLower === 'обід' && mealCue(context) && chosenIdx === 0 && stresses.includes(1)) {
    return { correctIdx: 1, reason: 'обід: їжа' };
  }
  return null;
};

export const findHeteronymFlags = (
  textStressed: string,
  context: string,
  lookupFull: (word: string) => { stress: number; stresses: number[]; type: string } | null,
): HeteronymFlag[] => {
  const stressed = textStressed.normalize('NFC');
  const flags: HeteronymFlag[] = [];
  WORD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let tokenIndex = 0;
  while ((match = WORD_RE.exec(stressed)) !== null) {
    const raw = match[0];
    const plain = stripStressMarks(raw);
    const key = plain.toLocaleLowerCase('uk-UA');
    const full = lookupFull(key);
    if (
      full?.type === 'heteronym' &&
      full.stresses.length >= 2 &&
      raw.includes(STRESS_COMBINING_ACUTE)
    ) {
      const chosenIdx = stressedVowelIndex(raw);
      if (chosenIdx != null) {
        const hit = correctHeteronymIndex(key, chosenIdx, full.stresses, context);
        if (hit) {
          const correct = applyStressMark(plain, hit.correctIdx);
          if (correct && stripStressMarks(correct) === plain) {
            flags.push({
              tokenIndex,
              plain,
              chosenIdx,
              correctIdx: hit.correctIdx,
              chosen: applyStressMark(key, chosenIdx) ?? raw,
              correct: restoreWordCase(plain, correct),
              reason: hit.reason,
            });
          }
        }
      }
    }
    tokenIndex += 1;
  }
  return flags;
};

/** Apply flagged corrections onto a stressed line (by token index). */
export const applyHeteronymFixes = (
  textStressed: string,
  flags: readonly HeteronymFlag[],
): string => {
  if (flags.length === 0) return textStressed;
  const byIndex = new Map(flags.map((f) => [f.tokenIndex, f]));
  const source = textStressed.normalize('NFC');
  let out = '';
  let last = 0;
  let tokenIndex = 0;
  WORD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_RE.exec(source)) !== null) {
    out += source.slice(last, match.index);
    const raw = match[0];
    last = match.index + raw.length;
    const flag = byIndex.get(tokenIndex);
    out += flag ? flag.correct : raw;
    tokenIndex += 1;
  }
  out += source.slice(last);
  return out;
};
