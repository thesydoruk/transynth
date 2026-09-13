/**
 * Slot / protected-token rules shared across all games.
 * Tokens themselves are classified in {@link PLACEHOLDER_RE} / {@link splitTranslateSource}.
 */
export const englishPlaceholderRules = (): string[] => [
  '### SLOTS AND TAG PRESERVATION (CRITICAL):',
  '- Translate input uses "parts": strings plus integer slot ids. Optional "slots" lists kind only (alias, printf, var, tag, break, markup, keyword).',
  '- Output "parts" must contain the same slot ids, same counts. You may reorder ids for target-language grammar.',
  '- Never write raw engine tokens inside a string part: %s, %d, {0}, <Alias=…>, <Global=…>, <font>, [Mod], [Key], or ¤PH0¤ / ¤FK0¤.',
  '- The pipeline joins slots back. UI cost tags like "<20 Caps>" keep the "<20 " prefix in a slot; translate "Caps" to the target genitive after a number and keep the closing ">".',
  '- Stage directions in brackets like [Sarcasm] or [Whispering] are translatable prose, NOT slots — translate them.',
  '- Bare [Player] or [Name] without a known UI prefix are usually translatable; protected UI prefixes include [Mod], [Key], [Note], [Scrap], etc.',
  '',
  '### SLOT EXAMPLES:',
  '- Input parts ["Listen, ", 0, ", we need ", 1, " caps."] → ["Слухай, ", 0, ", нам потрібно ", 1, " кришок."].',
  '- Input parts ["Call Subway ", 0, "Caps>"] (slot 0 = "<20 ") → ["Викликати метро ", 0, "кришок>"].',
  '- Input parts [0, " gave ", 1, " to ", 2] → keep 0, 1, 2; do not invent inner syntax.',
  '- Input parts ["Ammo - Ballistic"] (no slots) → translate all words; do not invent slot ids.',
  '- WRONG: dropping an id, inventing id 3, or writing <Alias=Player> / %s / ¤PH0¤ inside a string.',
];

/** Slot rules for verify/audit. */
export const englishVerifyPlaceholderRules = (): string[] => [
  '### SLOTS AND TAG PRESERVATION (CRITICAL):',
  '- Verify receives "parts", "translation_parts", and optional "slots" (kind only).',
  '- translation_parts and any "suggestion" must use the same slot-id multiset as parts.',
  '- Suggestion is a parts array (or null). Do not write raw %s / <Alias=…> / ¤PH0¤ inside a string.',
  '- WRONG: dropping or inventing a slot id, or leaking a raw token into a string part.',
];

export const ukrainianVerifyPlaceholderRules = (): string[] => [
  '### ЗБЕРЕЖЕННЯ СЛОТІВ І ТЕГІВ (КРИТИЧНО):',
  '- Verify отримує "parts", "translation_parts" і опційно "slots" (лише kind).',
  '- translation_parts і "suggestion" мають ту саму мультимножину індексів, що й parts.',
  '- Suggestion — масив parts або null. Не пиши сирі %s / <Alias=…> / ¤PH0¤ у рядках.',
  '- ПОМИЛКА: пропустити чи вигадати індекс або вставити сирий токен у текстовий фрагмент.',
];

export const ukrainianPlaceholderRules = (): string[] => [
  '### ЗБЕРЕЖЕННЯ СЛОТІВ І ТЕГІВ (КРИТИЧНО):',
  '- Вхід: "parts" (рядки + цілі індекси) і опційно "slots" з kind.',
  '- У вихідних "parts" ті самі індекси, та сама кількість. Порядок можна змінити за граматикою української.',
  '- Не пиши в рядках сирі %s, %d, {0}, <Alias=…>, <Global=…>, <font>, [Mod], ¤PH0¤, ¤FK0¤.',
  '- UI-цінники "<20 Caps>": префікс "<20 " у слоті; "Caps" → "кришок" (род. мн. після числа); ">" не чіпай.',
  '- Ремарки [Sarcasm], [Whispering] — текст для перекладу, НЕ слоти.',
  '- [Mod], [Key], [Note], [Scrap] тощо — захищені UI-префікси (слоти).',
  '',
  '### ПРИКЛАДИ СЛОТІВ:',
  '- ["Listen, ", 0, ", we need ", 1, " caps."] → ["Слухай, ", 0, ", нам потрібно ", 1, " кришок."]',
  '- ["Call Subway ", 0, "Caps>"] → ["Викликати метро ", 0, "кришок>"] (слот 0 = "<20 ").',
  '- [0, " entered ", 1] → переклади слова, збережи 0 і 1.',
  '- ["T-51 Right Arm Armor"] (ARMO/FULL, без слотів) → ["Права рука T-51"] (лише якщо в source є Right/Left).',
  '- ["Hellfire Mk.II Arm Armor"] → ["Хелфайр броня для рук Mk.II"] — НЕ вигадуй сторону.',
  '- ПОМИЛКА: пропустити індекс, вигадати слот, вставити <Alias=Player> / %s / ¤PH0¤ у рядок.',
];
