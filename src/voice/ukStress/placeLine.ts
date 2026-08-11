import { STRESS_COMBINING_ACUTE, stripStressMarks } from '../stressedTranslation';
import type { UkStressDictionary } from './dictionary';

const WORD_RE = /[\p{L}\p{M}]+/gu;
const HAS_UA_VOWEL = /[аеєиіїоуюяАЕЄИІЇОУЮЯ]/u;

export type UnresolvedStressWord = {
  /** 0-based index among letter-tokens in the line. */
  tokenIndex: number;
  word: string;
  reason: 'oov' | 'heteronym';
};

export type DictionaryStressPlacement = {
  /** Line with dictionary stresses applied; unresolved words left unmarked. */
  partialStressed: string;
  unresolved: UnresolvedStressWord[];
};

/**
 * Restore capitalization of `marked` (NFC, with U+0301) to match `plain`.
 * Handles Title Case and ALL CAPS; combining acute stays after the vowel.
 */
export const restoreWordCase = (plain: string, marked: string): string => {
  const plainNfc = plain.normalize('NFC');
  const markedNfc = marked.normalize('NFC');
  if (plainNfc === plainNfc.toLocaleLowerCase('uk-UA')) return markedNfc;

  const plainLetters = [...plainNfc];
  const markedChars = [...markedNfc];
  let pi = 0;
  let out = '';
  for (const ch of markedChars) {
    if (ch === STRESS_COMBINING_ACUTE) {
      out += ch;
      continue;
    }
    const src = plainLetters[pi] ?? ch;
    pi += 1;
    if (src.toLocaleUpperCase('uk-UA') === src && src.toLocaleLowerCase('uk-UA') !== src) {
      out += ch.toLocaleUpperCase('uk-UA');
    } else {
      out += ch;
    }
  }
  return out;
};

const markKnownWord = (dict: UkStressDictionary, plain: string): string | null => {
  const lower = plain.toLocaleLowerCase('uk-UA');
  const marked = dict.mark(lower) ?? dict.mark(plain);
  if (!marked) return null;
  return restoreWordCase(plain, marked);
};

/**
 * Apply dictionary stress to every unambiguous / variative word.
 * Heteronyms and OOV words are left unmarked and listed in `unresolved`.
 */
export const placeLineWithDictionary = (
  dict: UkStressDictionary,
  text: string,
): DictionaryStressPlacement => {
  const source = text.normalize('NFC');
  const unresolved: UnresolvedStressWord[] = [];
  let out = '';
  let last = 0;
  let tokenIndex = 0;
  WORD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_RE.exec(source)) !== null) {
    out += source.slice(last, match.index);
    const raw = match[0];
    const plain = stripStressMarks(raw);
    last = match.index + raw.length;

    if (!HAS_UA_VOWEL.test(plain)) {
      out += plain;
      tokenIndex += 1;
      continue;
    }

    const full = dict.lookupFull(plain) ?? dict.lookupFull(plain.toLocaleLowerCase('uk-UA'));
    if (!full) {
      // Short OOV clitics (я, і, це…) — leave unmarked; not worth an LLM call.
      if ([...plain].length > 2) {
        unresolved.push({ tokenIndex, word: plain, reason: 'oov' });
      }
      out += plain;
      tokenIndex += 1;
      continue;
    }
    if (full.type === 'heteronym') {
      unresolved.push({ tokenIndex, word: plain, reason: 'heteronym' });
      out += plain;
      tokenIndex += 1;
      continue;
    }

    const marked = markKnownWord(dict, plain);
    out += marked ?? plain;
    if (!marked) {
      unresolved.push({ tokenIndex, word: plain, reason: 'oov' });
    }
    tokenIndex += 1;
  }
  out += source.slice(last);
  return { partialStressed: out, unresolved };
};

/**
 * Replace unresolved letter-tokens in `partialStressed` with LLM-stressed forms.
 * Keys are tokenIndex → stressed word (must match letters of the plain token).
 */
export const mergeLlmWordStress = (
  partialStressed: string,
  stressedByTokenIndex: ReadonlyMap<number, string>,
): string => {
  if (stressedByTokenIndex.size === 0) return partialStressed;
  const source = partialStressed.normalize('NFC');
  let out = '';
  let last = 0;
  let tokenIndex = 0;
  WORD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_RE.exec(source)) !== null) {
    out += source.slice(last, match.index);
    const raw = match[0];
    last = match.index + raw.length;
    const replacement = stressedByTokenIndex.get(tokenIndex);
    if (replacement) {
      const plain = stripStressMarks(raw);
      const replPlain = stripStressMarks(replacement);
      out += replPlain === plain ? restoreWordCase(plain, replacement.normalize('NFC')) : plain;
    } else {
      out += raw;
    }
    tokenIndex += 1;
  }
  out += source.slice(last);
  return out;
};
