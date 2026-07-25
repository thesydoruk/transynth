/**
 * Placeholder preservation rules shared across all games.
 * Wording matches {@link PLACEHOLDER_RE} in `src/utils/placeholders.ts`.
 */
export const englishPlaceholderRules = (): string[] => [
  '### PLACEHOLDER AND TAG PRESERVATION (CRITICAL):',
  '- During translate you receive pre-masked source: opaque keys like ¤PH0¤, ¤FK0¤ (and ¤GL0¤ when glossary masking is used).',
  '- Copy every mask key into the translation unchanged — same count, same spelling, no spaces inside (NOT "¤ PH0 ¤").',
  '- After masking, the pipeline restores originals such as %s, %d, %2$s, %.0f%%, {0}, {name}, $PlayerName, <Alias=Player>, <Global=…>, <font>, [Mod], [Key], [*Class], [DIAL:001234AB], and line breaks.',
  '- UI cost tags like "<20 Caps>" keep the "<20 " prefix masked; translate "Caps" to "кришок" (genitive after a number) and keep the closing ">".',
  '- You may reorder mask keys within the sentence for target-language grammar.',
  '- Stage directions in brackets like [Sarcasm] or [Whispering] are translatable prose, NOT protected tags — translate them.',
  '- Bare [Player] or [Name] without a known UI prefix are usually translatable; protected UI prefixes include [Mod], [Key], [Note], [Scrap], etc.',
  '',
  '### PLACEHOLDER EXAMPLES:',
  '- Source (masked): "Listen, ¤PH0¤, we need ¤PH1¤ caps." → "Слухай, ¤PH0¤, нам потрібно ¤PH1¤ кришок." (keys preserved; words around them translated).',
  '- Source (masked): "Call Subway ¤PH0¤Caps>" → "Викликати метро ¤PH0¤кришок>" (¤PH0¤ restores "<20 ").',
  '- Source (masked): "¤PH0¤ gave {item} to ¤PH1¤" → keep both ¤PH0¤ and ¤PH1¤; do not expose or alter inner syntax of restored tokens.',
  '- Source: "Ammo - Ballistic" (no masks) → translate all words; do not invent placeholders.',
  '- WRONG: dropping ¤PH0¤, splitting it as "¤ PH0 ¤", or replacing %s with %d.',
];

/** Placeholder rules for verify/audit (pre-masked like translate). */
export const englishVerifyPlaceholderRules = (): string[] => [
  '### PLACEHOLDER AND TAG PRESERVATION (CRITICAL):',
  '- Verify receives pre-masked "source", "translation", and "reference_examples": opaque keys like ¤PH0¤, ¤PH1¤.',
  '- Every mask key in source must appear in translation and in any "suggestion" unchanged — same count, same spelling.',
  '- Copy mask keys into suggestions exactly; the pipeline restores originals such as %s, <Alias=…>, <Global=…>, <font>, [Mod] after the response.',
  '- WRONG: dropping ¤PH0¤, splitting it as "¤ PH0 ¤", or replacing one mask key with another.',
];

export const ukrainianVerifyPlaceholderRules = (): string[] => [
  '### ЗБЕРЕЖЕННЯ ПЛЕЙСХОЛДЕРІВ І ТЕГІВ (КРИТИЧНО):',
  '- Verify отримує замасковані поля "source", "translation" і "reference_examples": ключі ¤PH0¤, ¤PH1¤ тощо.',
  '- Усі ключі з source мають бути в translation і в "suggestion" без змін — та сама кількість, той самий напис.',
  '- Копіюй ключі в suggestion без змін; після відповіді пайплайн відновлює %s, <Alias=…>, <Global=…>, <font>, [Mod] тощо.',
  '- ПОМИЛКА: пропустити ¤PH0¤, розбити "¤ PH0 ¤" або замінити один ключ іншим.',
];

export const ukrainianPlaceholderRules = (): string[] => [
  '### ЗБЕРЕЖЕННЯ ПЛЕЙСХОЛДЕРІВ І ТЕГІВ (КРИТИЧНО):',
  '- У полі "source" ти отримуєш уже замаскований текст: ключі ¤PH0¤, ¤FK0¤ (та ¤GL0¤ за наявності glossary mask).',
  '- Копіюй кожен ключ у переклад БЕЗ ЗМІН — та сама кількість, той самий напис, без пробілів усередині (НЕ "¤ PH0 ¤").',
  '- Після розмаскування відновлюються %s, %d, %2$s, %.0f%%, {0}, {name}, $PlayerName, <Alias=Player>, <Global=…>, <font>, [Mod], [Key], [*Class], [DIAL:001234AB] та переноси рядків.',
  '- UI-цінники на кшталт "<20 Caps>": префікс "<20 " лишається замаскованим (¤PH*¤); "Caps" переклади як "кришок" (род. мн. після числа); ">" не чіпай.',
  '- Дозволено змінювати порядок ключів у реченні за граматикою української.',
  '- Ремарки в дужках на кшталт [Sarcasm], [Whispering] — це текст для перекладу, НЕ захищені теги.',
  '- [Mod], [Key], [Note], [Scrap] тощо — захищені UI-префікси; не перекладай їхній синтаксис.',
  '',
  '### ПРИКЛАДИ ПЛЕЙСХОЛДЕРІВ:',
  '- Source: "Listen, ¤PH0¤, we need ¤PH1¤ caps." → "Слухай, ¤PH0¤, нам потрібно ¤PH1¤ кришок."',
  '- Source: "Call Subway ¤PH0¤Caps>" → "Викликати метро ¤PH0¤кришок>" (¤PH0¤ = "<20 ").',
  '- Source: "<Alias=Player> entered ¤PH0¤" → переклади слова, збережи ¤PH0¤; після розмаскування <Alias=Player> має лишитися незмінним.',
  '- Source: "T-51 Right Arm Armor" (ARMO/FULL, без масок) → "Права рука T-51" (лише якщо в source є Right/Left; див. правила гри).',
  '- Source: "Hellfire Mk.II Arm Armor" → "Хелфайр броня для рук Mk.II" — НЕ "Права рука Hellfire Mk.II" (не вигадуй сторону, не лишай англійську).',
  '- ПОМИЛКА: пропустити ¤PH0¤, розбити "¤ PH0 ¤", замінити %s на %d або <Alias=Player> на <Гравець>.',
];
