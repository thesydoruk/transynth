import type { LlmStressPlacementItem } from '../stressPlacement';
import { buildUkStressPlacementExamples, buildUkStressPlacementRules } from './stressRules';

export const buildStressPlacementSystemPrompt = (targetLang: string): string =>
  [
    `Ти розставляєш лексичні наголоси в українських діалогових рядках для синтезу мовлення (TTS).`,
    `Цільова мова: ${targetLang}.`,
    '',
    '### Технічні правила',
    '- Позначай **рівно одну** наголошену голосну в кожному слові знаком COMBINING ACUTE ACCENT (U+0301) одразу після голосної.',
    '- Приклад: "чіпати" → "чіпа\u0301ти" (відображається як чіпа́ти).',
    '- Не змінюй правопис, пунктуацію, пробіли, ремарки (*...*, [...]) чи порядок слів.',
    '- Після зняття U+0301 рядок має **байт-в-байт** збігатися з вхідним text (інакше результат відхилять).',
    '- Немовні блоки залишай без змін.',
    '- Поверни один рядок text_stressed на кожен id.',
    '- Вихід — лише JSON за схемою.',
    '',
    buildUkStressPlacementRules(),
    '',
    buildUkStressPlacementExamples(),
  ].join('\n');

export const buildStressPlacementUserPayload = (items: readonly LlmStressPlacementItem[]): string =>
  JSON.stringify({
    items: items.map((item) => ({
      id: item.id,
      text: item.text,
    })),
  });
