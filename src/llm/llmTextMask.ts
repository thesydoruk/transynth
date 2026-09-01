/**
 * Mask game placeholders before LLM requests and restore them in model output.
 * Uses ¤PH0¤, ¤PH1¤, … — same keys as {@link maskPlaceholders}.
 * Disco lockit markup is masked as ¤IT¤ / ¤Q¤ / ¤TS¤ / ¤EM¤ after placeholders.
 */
import { restoreDiscoCensoredSpeech } from '../formats/po/discoCensorship';
import { maskDiscoLockitMarkupIfDisco } from '../formats/po/discoMarkupMask';
import type { GameType } from '../types';
import {
  PLACEHOLDER_PATTERN_PARTS,
  maskFunctionKeywords,
  maskPlaceholders,
  unmask,
  type ProtectedTokenContext,
} from '../utils/placeholders';

export type LlmTextMaskResult = { masked: string; mapping: Record<string, string> };

const placeholderRe = (): RegExp => new RegExp(PLACEHOLDER_PATTERN_PARTS.join('|'), 'g');

/** Mask placeholders in one string. */
export const maskLlmText = (text: string): LlmTextMaskResult => maskPlaceholders(text);

/** Restore masked keys using a prior {@link maskLlmText} / {@link maskLlmTextFields} mapping. */
export const unmaskLlmText = (text: string, mapping: Record<string, string>): string =>
  unmask(text, mapping);

/**
 * Mask several strings with one shared ¤PHn¤ counter.
 * Use when one LLM item spans source + translation + context so suggestions can reuse keys.
 *
 * With `reuseKeysForIdenticalTokens` (default for verify), the same placeholder literal
 * always maps to one key — e.g. `<Alias=X>` in source and translation both become ¤PH0¤.
 */
export const maskLlmTextFields = (
  fields: Array<string | null | undefined>,
  opts?: { reuseKeysForIdenticalTokens?: boolean },
): { masked: Array<string | null>; mapping: Record<string, string> } => {
  const mapping: Record<string, string> = {};
  const tokenToKey = new Map<string, string>();
  let i = 0;
  const reuse = opts?.reuseKeysForIdenticalTokens ?? false;

  const masked = fields.map((field) => {
    if (field == null) return null;
    return field.replace(placeholderRe(), (m) => {
      const existing = reuse ? tokenToKey.get(m) : undefined;
      if (existing) return existing;

      const key = `¤PH${i}¤`;
      mapping[key] = m;
      if (reuse) tokenToKey.set(m, key);
      i++;
      return key;
    });
  });
  return { masked, mapping };
};

/** Mask optional text; returns null unchanged. */
export const maskLlmOptionalText = (text: string | null | undefined): string | null => {
  if (text == null) return null;
  return maskLlmText(text).masked;
};

const maskFieldForLlm = (text: string, game?: GameType | string | null): string =>
  maskDiscoLockitMarkupIfDisco(maskLlmText(text).masked, game ?? null).masked;

/** Mask source/translation in RAG examples (each field masked independently). */
export const maskLlmReferenceExamples = <T extends { source: string; translation: string }>(
  examples: T[] | undefined,
  game?: GameType | string | null,
): T[] | undefined => {
  if (!examples?.length) return examples;
  return examples.map((ex) => ({
    ...ex,
    source: maskFieldForLlm(restoreDiscoCensoredSpeech(ex.source), game),
    translation: maskFieldForLlm(restoreDiscoCensoredSpeech(ex.translation), game),
  }));
};

/**
 * PH → FK → Disco lockit keys for a translate source.
 * Disco wrapper keys are merged into `placeholderMap` so existing unmask works.
 */
export const maskTranslateSource = (
  text: string,
  game?: GameType | string | null,
  context?: ProtectedTokenContext | null,
): {
  masked: string;
  placeholderMap: Record<string, string>;
  functionKeywordMap: Record<string, string>;
} => {
  const { masked: placeholderMasked, mapping: placeholderMap } = maskPlaceholders(text);
  const { masked: fkMasked, mapping: functionKeywordMap } = maskFunctionKeywords(
    placeholderMasked,
    game as GameType | undefined,
    context,
  );
  const disco = maskDiscoLockitMarkupIfDisco(fkMasked, game ?? null);
  return {
    masked: disco.masked,
    placeholderMap: { ...placeholderMap, ...disco.mapping },
    functionKeywordMap,
  };
};
