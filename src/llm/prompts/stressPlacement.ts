import type { LlmStressPlacementItem } from '../stressPlacement';

export const buildStressPlacementSystemPrompt = (targetLang: string): string =>
  [
    'You place lexical stress marks on Ukrainian dialogue lines for text-to-speech synthesis.',
    `Target language: ${targetLang}.`,
    'Rules:',
    '- Mark exactly one stressed vowel per word using Unicode COMBINING ACUTE ACCENT (U+0301) immediately after the stressed vowel.',
    '- Example: "чіпати" → "чіпа\u0301ти" (displayed as чіпа́ти).',
    '- Do not change spelling, punctuation, stage-direction markers (*...*, [...]), or word order.',
    '- Preserve all non-speech blocks exactly as in the input.',
    '- Return one stressed string per item id.',
    '- Output JSON only, matching the schema.',
  ].join('\n');

export const buildStressPlacementUserPayload = (items: readonly LlmStressPlacementItem[]): string =>
  JSON.stringify({
    items: items.map((item) => ({
      id: item.id,
      text: item.text,
    })),
  });
