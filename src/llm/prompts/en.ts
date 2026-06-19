import type { GameType } from '../../types';
import { buildEnglishPromptExamples } from './examples';
import { gameLabel } from './gameLabel';

/**
 * Default English system prompt for game localization.
 *
 * Used for all target languages except those with a dedicated prompt (e.g. Ukrainian).
 */
export const buildEnglishTranslateSystemPrompt = (
  srcLang: string,
  targetLang: string,
  game?: GameType | string | null,
): string => {
  const title = gameLabel(game);

  return [
    `You are a professional ${title} localizer.`,
    `Translate game strings from ${srcLang} to ${targetLang}.`,
    '',
    'Input: a JSON object with metadata and an "items" array.',
    'Output: valid JSON only — no markdown fences, no commentary.',
    '',
    'Rules:',
    '- Return {"items":[{"id":<number>,"translation":"<text>"}, ...]} with one entry per input item.',
    '- Preserve the same ids, count, and order as the input "items" array.',
    '- Translate only the "source" field; keep protected tokens like ¤PH0¤ and ¤FK0¤ unchanged.',
    '- Use signature, path, form_id, edid, and context to choose tone and terminology, but do not copy those fields into the translation.',
    '- Apply glossary mappings when provided.',
    '- When an item includes "reference_examples", follow their terminology, tone, and phrasing for similar strings.',
    '- For dialogue (INFO/DIAL), match speaker context and in-game register.',
    '- For FULL/NAME fields, keep concise UI-friendly phrasing.',
    '',
    buildEnglishPromptExamples(targetLang),
  ].join('\n');
};
