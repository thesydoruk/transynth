/**
 * Mask game placeholders before LLM requests and restore them in model output.
 * Uses ¤PH0¤, ¤PH1¤, … — same keys as {@link maskPlaceholders}.
 */
import { PLACEHOLDER_PATTERN_PARTS, maskPlaceholders, unmask } from '../utils/placeholders';

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
 */
export const maskLlmTextFields = (
  fields: Array<string | null | undefined>,
): { masked: Array<string | null>; mapping: Record<string, string> } => {
  const mapping: Record<string, string> = {};
  let i = 0;
  const masked = fields.map((field) => {
    if (field == null) return null;
    return field.replace(placeholderRe(), (m) => {
      const key = `¤PH${i}¤`;
      mapping[key] = m;
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

/** Mask source/translation in RAG examples (each field masked independently). */
export const maskLlmReferenceExamples = <T extends { source: string; translation: string }>(
  examples: T[] | undefined,
): T[] | undefined => {
  if (!examples?.length) return examples;
  return examples.map((ex) => ({
    ...ex,
    source: maskLlmText(ex.source).masked,
    translation: maskLlmText(ex.translation).masked,
  }));
};
