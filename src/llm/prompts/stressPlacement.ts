import type { LlmStressWordItem } from '../stressPlacement';
import { buildUkStressPlacementExamples, buildUkStressPlacementRules } from './stressRules';

export const buildStressPlacementSystemPrompt = (targetLang: string): string =>
  [
    'Ти розставляєш лексичні наголоси на окремих українських словах для TTS.',
    `Цільова мова: ${targetLang}.`,
    'Словник уже позначив однозначні слова; тобі лишаються лише OOV та омографи.',
    '',
    '### Технічні правила',
    '- Поверни `word_stressed` з COMBINING ACUTE ACCENT (U+0301) для кожного `id`.',
    '- Приклад: "чіпати" → "чіпа\u0301ти" (чіпа́ти).',
    '- Не повертай цілий рядок — лише наголошену форму слова.',
    '- Вихід — лише JSON за схемою.',
    '',
    buildUkStressPlacementRules(),
    '',
    buildUkStressPlacementExamples(),
  ].join('\n');

export const buildStressPlacementUserPayload = (words: readonly LlmStressWordItem[]): string =>
  JSON.stringify({
    words: words.map((item) => ({
      id: item.id,
      word: item.word,
      context: item.context,
      word_index: item.wordIndex,
    })),
  });
