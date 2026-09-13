/** MCM menu rules shared by English composed prompts and UK standalone copies. */

export const mcmUiTranslateRulesEn = (): string[] => [
  '',
  '### MCM MENU STRINGS (grup MCM):',
  '- These are Mod Configuration Menu labels and help text, not dialogue.',
  '- context may include page=, type=, help=, label= — use only to disambiguate meaning. Do not copy those words into a short source.',
  '- Labels (switcher, slider, button, page title): keep as short as source. Do not expand a label with its help= text.',
  '- Help/tooltip strings may be longer; do not shrink them to the paired label=.',
  '- field ($key) is an identifier, not text to translate.',
];

export const mcmUiVerifyRulesEn = (): string[] => [
  '',
  '### MCM MENU STRINGS (VERIFY, grup MCM):',
  '- Label expanded with words from help=/page=/type= that are absent from source → "incorrect" (or "suspicious" if only a mild expansion).',
  '- Help/tooltip shortened to the paired label when source is a full sentence → "suspicious".',
  '- context is orientation only; do not copy it into suggestion.',
];

export const MCM_UI_TRANSLATE_RULES_UK = `- **MCM (grup: MCM)**: меню налаштувань мода, не діалог. Поле context може містити page=, type=, help=, label= — орієнтир змісту, НЕ джерело слів для перекладу.
  - Лейбл (свічер, слайдер, кнопка, назва сторінки): такий самий короткий UI, як у source. НЕ копіюй текст із help= у лейбл.
  - Help/підказка: можна довше; НЕ скорочуй до лейбла з label=.
  - field ($ключ) — ідентифікатор, не текст для перекладу.`;

export const MCM_UI_VERIFY_RULES_UK = `- **MCM (grup: MCM)**: лейбл, роздутий словами з help=/page=/type=, яких немає в source → **"incorrect"** (легке розширення — **"suspicious"**). Help, урізаний до парного лейбла, коли source — речення → **"suspicious"**. context не копіюй у suggestion.`;
