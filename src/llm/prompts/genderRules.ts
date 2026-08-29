/**
 * Ukrainian gender rules for Bethesda game prompts (not Disco Elysium).
 *
 * Each line of dialog now arrives with `speaker_gender` and `addressee_gender`
 * resolved from the plugin, so the model is told which grammatical gender to
 * use instead of being told to avoid the question. The one case where avoidance
 * is still correct is the player character, whose gender is a runtime choice
 * and therefore arrives as `any`.
 */

const UK_ENDEARMENT_TRANSLATE = `- **Пестливі звертання** (honey, hon, sweetheart, sweetie, darling, darlin', dear, love, babe, baby): гендерно-нейтральні іменники «сонечко», «золотко», «серденько» — чергуй за тоном. НІКОЛИ «любий» / «люба». «my dear» → «моє сонечко» / «моє золотко» / «моє серденько». Якщо слово — прикметник до іменника («Home Sweet Home», «sweet girl») — звичайний прикметник, не звертання.
- **Весь рядок, не лише звертання**: у репліці ДО гравця (\`addressee_gender: "any"\`) або коли стать адресата невідома жодна форма другої особи не сміє маркувати рід — ні «ти міг би / ти допомогла / ти впевнена», ні «ви прекрасна». Перефразуй увесь присудок: теперішній час, наказ, «ви»+множина або безособове. "Thanks, honey. You were a big help." → «Дякую за допомогу, сонечко.»; "Hon, could you help me?" → «Сонечко, можеш допомогти?»; "You're perfect, my dear." → «Ви прекрасні, золотко.» Якщо адресат — конкретний NPC з male/female, узгоджуй рід як звичайно.`;

const UK_ENDEARMENT_VERIFY = `- «любий» / «люба» як пестливе звертання (не прикметник при іменнику на кшталт «любий дім») → **"suspicious"**; suggestion з «сонечко» / «золотко» / «серденько».
- Пестливе «сонечко» / «золотко» / «серденько» плюс маркована друга особа однини («ти міг», «ти допомогла», «ви прекрасна») при адресаті-гравці або unknown → **"suspicious"**; suggestion нейтралізує **весь** рядок, не лише звертання.`;

/**
 * Gender rules for a translation prompt.
 *
 * @param playerLabel - The game's player character in Ukrainian nominative,
 * e.g. «Драконоборець». Always rendered parenthetically so no case agreement
 * with the surrounding sentence is needed.
 */
export const buildUkGenderTranslateRules = (playerLabel: string): string =>
  `- **Рід за метаданими (КРИТИЧНО)**: поля \`speaker\`, \`speaker_gender\`, \`addressee\`, \`addressee_gender\` задають хто говорить і до кого звертається. Використовуй їх у кожному INFO-рядку, де вони є.
  - \`speaker_gender: "male"\` → перша особа в чоловічому роді: «я був», «я сказав», «я готовий».
  - \`speaker_gender: "female"\` → перша особа в жіночому роді: «я була», «я сказала», «я готова».
  - \`addressee_gender: "male"/"female"\` → друга особа однини узгоджується так само: «ти впевнений» / «ти впевнена».
  - \`addressee_gender: "any"\` (адресат — гравець, \`addressee: "Player"\`) → **репліка ДО гравця**: без маркованих форм другої особи однини («ти готовий/готова»); «ви»+множина («Ви готові?») або безособовий перефраз («Усе готово?»).
  - \`speaker_gender: "any"\` (\`speaker: "Player"\`) → **репліка гравця за замовчуванням**: без маркованих форм першої особи; безособовий перефраз або «ви»+множина.
  - \`speaker_gender: "male"/"female"\` при \`speaker: "Player"\` → **стать-специфічна версія гравця** (окремий INFO для Nate/Nora): переклади з відповідним родом першої особи.
  - \`"unknown"\` чи поле відсутнє — не вгадуй: нейтральна конструкція (безособове, інфінітив, іменник, «треба…»), **не** чоловічий рід «за замовчуванням».
  - Метадані сильніші за здогад із source: при \`speaker_gender: "female"\` "I was ready" → «Я була готова», а не безособовий перефраз.
  - Поля \`speaker\` і \`addressee\` дають імена учасників — використовуй для кличного відмінка та тону, не додавай їх у переклад.
- **Звертання до гравця**: «ви» з формами множини («Ви готові?»), не «Ти готовий/готова?» — коли \`addressee_gender\` є \`any\` або поле відсутнє, а рядок звернений до гравця.
${UK_ENDEARMENT_TRANSLATE}
- **Третя особа**: невідомі they/someone → «хтось», пасив, безособове — не «він/вона» без підказки в source, \`context\` чи метаданих.
- **«your» до гравця**: «ваші», нейтральний іменник («Зброя в інвентарі») або перефраз без присвійника.`;

/** Gender rules for a verification prompt. */
export const buildUkGenderVerifyRules = (playerLabel: string): string =>
  `- **Рід за метаданими (КРИТИЧНО)**: звіряй рід у translation з \`speaker\`, \`speaker_gender\`, \`addressee\`, \`addressee_gender\` — використовуй усі наявні поля.
  - Розбіжність із "male"/"female" → **"incorrect"**: «я була» при \`speaker_gender: "male"\`, «ти готовий» при \`addressee_gender: "female"\`.
  - \`addressee_gender: "any"\` (\`addressee: "Player"\`) → репліка **до гравця**: маркована друга особа однини («ти готовий/готова») → **"suspicious"**; «ви»+множина або безособовий перефраз → "ok".
  - \`speaker_gender: "any"\` (\`speaker: "Player"\`) → репліка **гравця**: маркована перша особа → **"suspicious"**, якщо це не стать-специфічна версія.
  - \`speaker_gender: "male"/"female"\` при \`speaker: "Player"\` → стать-специфічна версія гравця: відповідний рід першої особи → "ok".
  - \`"unknown"\` чи поле відсутнє: чоловічий рід «за замовчуванням» без підказки в source → "suspicious"; коректний нейтральний перефраз → "ok".
  - Якщо метадані задають рід, а переклад безособовий і природний — це "ok"; не переписуй його на гендерований без потреби.
  - Поля \`speaker\` і \`addressee\` — імена учасників: перевіряй кличний відмінок, але не вимагай додавати імена в переклад.
${UK_ENDEARMENT_VERIFY}`;
