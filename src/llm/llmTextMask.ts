/**
 * Mask game placeholders before LLM requests and restore them in model output.
 * Uses ¤PH0¤, ¤PH1¤, … — same keys as {@link maskPlaceholders}.
 * A game may mask markup of its own on top (Disco's lockit ¤IT¤ / ¤Q¤ / ¤TS¤ / ¤EM¤).
 */
import { gamePlugin } from '../games/registry';
import type { GameId } from '../types';
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

const maskFieldForLlm = (text: string, game?: GameId | string | null): string =>
  gamePlugin(game).text.maskMarkup(maskLlmText(text).masked).masked;

/** Mask source/translation in RAG examples (each field masked independently). */
export const maskLlmReferenceExamples = <T extends { source: string; translation: string }>(
  examples: T[] | undefined,
  game?: GameId | string | null,
): T[] | undefined => {
  if (!examples?.length) return examples;
  const { text } = gamePlugin(game);
  return examples.map((ex) => ({
    ...ex,
    source: maskFieldForLlm(text.restoreCensoredSpeech(ex.source), game),
    translation: maskFieldForLlm(text.restoreCensoredSpeech(ex.translation), game),
  }));
};

/**
 * Placeholders, then function keywords, then whatever markup the game masks.
 * Markup keys are merged into `placeholderMap` so one unmask call restores all.
 */
export const maskTranslateSource = (
  text: string,
  game?: GameId | string | null,
  context?: ProtectedTokenContext | null,
): {
  masked: string;
  placeholderMap: Record<string, string>;
  functionKeywordMap: Record<string, string>;
} => {
  const { masked: placeholderMasked, mapping: placeholderMap } = maskPlaceholders(text);
  const { masked: fkMasked, mapping: functionKeywordMap } = maskFunctionKeywords(
    placeholderMasked,
    game as GameId | undefined,
    context,
  );
  const markup = gamePlugin(game).text.maskMarkup(fkMasked);
  return {
    masked: markup.masked,
    placeholderMap: { ...placeholderMap, ...markup.mapping },
    functionKeywordMap,
  };
};
