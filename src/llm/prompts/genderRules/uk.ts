/**
 * Ukrainian gender rules shared by every game prompt.
 *
 * Each line of dialog now arrives with `speaker_gender` and `addressee_gender`
 * resolved from the plugin, so the model is told which grammatical gender to
 * use instead of being told to avoid the question. The one case where avoidance
 * is still correct is the player character, whose gender is a runtime choice
 * and therefore arrives as `any`.
 */

/**
 * Gender rules for a translation prompt.
 *
 * @param playerLabel - The game's player character in Ukrainian nominative,
 * e.g. «Драконоборець». Always rendered parenthetically so no case agreement
 * with the surrounding sentence is needed.
 */
export const buildUkGenderTranslateRules = (playerLabel: string): string =>
  `- **Рід за метаданими (КРИТИЧНО)**: поля \`speaker_gender\` (хто говорить) і \`addressee_gender\` (до кого звертаються) задають граматичний рід. Значення: "male", "female", "any", "unknown".
  - \`speaker_gender: "male"\` → перша особа в чоловічому роді: «я був», «я сказав», «я готовий».
  - \`speaker_gender: "female"\` → перша особа в жіночому роді: «я була», «я сказала», «я готова».
  - \`addressee_gender: "male"/"female"\` → друга особа однини узгоджується так само: «ти впевнений» / «ти впевнена».
  - \`"any"\` — стать обирає гравець (${playerLabel}): марковані форми **заборонені**; безособовий перефраз («Мене це здивувало», «Усе готово?») або «ви»+множина.
  - \`"unknown"\` чи поле відсутнє — не вгадуй: нейтральна конструкція (безособове, інфінітив, іменник, «треба…»), **не** чоловічий рід «за замовчуванням».
  - Метадані сильніші за здогад із source: при \`speaker_gender: "female"\` "I was ready" → «Я була готова», а не безособовий перефраз.
  - Поля \`speaker\` і \`addressee\` дають імена учасників — використовуй для кличного відмінка, не додавай їх у переклад.
- **Звертання до гравця**: «ви» з формами множини («Ви готові?»), не «Ти готовий/готова?» — навіть коли \`addressee_gender\` відсутній.
- **Третя особа**: невідомі they/someone → «хтось», пасив, безособове — не «він/вона» без підказки в source, \`context\` чи метаданих.
- **«your» до гравця**: «ваші», нейтральний іменник («Зброя в інвентарі») або перефраз без присвійника.`;

/** Gender rules for a verification prompt. */
export const buildUkGenderVerifyRules = (playerLabel: string): string =>
  `- **Рід за метаданими (КРИТИЧНО)**: звіряй рід у translation з \`speaker_gender\` (перша особа) та \`addressee_gender\` (друга особа однини).
  - Розбіжність із "male"/"female" → **"incorrect"**: «я була» при \`speaker_gender: "male"\`, «ти готовий» при \`addressee_gender: "female"\`.
  - Будь-яка маркована форма першої/другої особи при \`"any"\` → **"suspicious"**: стать обирає гравець (${playerLabel}), потрібен безособовий перефраз або «ви»+множина.
  - \`"unknown"\` чи поле відсутнє: чоловічий рід «за замовчуванням» без підказки в source → "suspicious"; коректний нейтральний перефраз → "ok".
  - Якщо метадані задають рід, а переклад безособовий і природний — це "ok"; не переписуй його на гендерований без потреби.
  - Поля \`speaker\` і \`addressee\` — імена учасників: перевіряй кличний відмінок, але не вимагай додавати імена в переклад.`;
