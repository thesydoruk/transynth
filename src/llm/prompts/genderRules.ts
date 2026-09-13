/**
 * Ukrainian gender rules for Bethesda game prompts (not Disco Elysium).
 *
 * Fields come from the plugin. Do not guess player gender. Register («ти»/«ви»)
 * is per-game: most titles keep formal «ви»; Fallout 4 wasteland uses «ти».
 */

import { promptJsonItems } from './promptJsonFormat';

/** How the game addresses the player in the second person. */
export type UkPlayerRegister = 'formal-vy' | 'wasteland-ty';

const UK_GENDER_RECAST_ITEMS = [
  {
    source: "I've been waiting for you.",
    speaker: 'Player',
    speaker_gender: 'any',
    translation: 'Я вже давно на тебе чекаю.',
    bad: ['Я чекав тебе.', 'Я чекала тебе.'],
  },
  {
    source: "I'm tired.",
    speaker: 'Player',
    speaker_gender: 'any',
    translation: 'Я вже без сил.',
    bad: ['Я втомився.', 'Я втомилася.', 'Я вже без сил. Сил уже немає.'],
  },
  {
    source: "I haven't found anyone yet.",
    speaker: 'Player',
    speaker_gender: 'any',
    translation: 'Ще нікого не вдалося знайти.',
    bad: ['Ще нікого не знайшов.', 'Ще нікого не знайшла.'],
  },
  {
    source: 'I was surprised.',
    speaker_gender: 'any',
    translation: 'Мене це здивувало.',
    bad: ['Я був здивований.', 'Я була здивована.'],
  },
  {
    source: 'I was used to it.',
    speaker_gender: 'any',
    translation: 'Це вже було звичкою.',
    bad: ['Я звик.', 'Я звикла.'],
  },
  {
    source: 'I knew.',
    speaker_gender: 'any',
    translation: 'Це було відомо.',
    bad: ['Я знав.', 'Я знала.'],
  },
  {
    source: 'I was glad I could listen.',
    speaker_gender: 'any',
    translation: 'Було приємно просто послухати.',
    bad: ['Я був радий.', 'Я була рада.'],
  },
  {
    source: 'I made a choice.',
    speaker_gender: 'any',
    translation: 'Зроблено вибір.',
    bad: ['Я зробив вибір.', 'Я зробила вибір.'],
  },
  {
    source: 'I Let Them Go',
    field: 'RNAM',
    speaker_gender: 'any',
    translation: 'Відпустити їх.',
    bad: ['Я їх відпустив.', 'Я їх відпустила.'],
  },
  {
    source: "It wasn't what I was expecting from you.",
    speaker_gender: 'any',
    translation: 'Не те, на що від тебе можна було розраховувати.',
    bad: ['Не те, чого я чекав/чекала.', 'Не те, чого я чекав. Не те, чого я чекала.'],
  },
  {
    source: 'I really appreciate you saying that.',
    addressee_gender: 'any',
    translation: 'Дякую за ці слова.',
    bad: ['Дякую, що сказав.', 'Дякую, що сказала.'],
  },
  {
    source: 'Got it.',
    speaker_gender: 'any',
    translation: 'Зрозуміло.',
    bad: ['Зрозумів.', 'Зрозуміла.'],
  },
  {
    source: 'Not Sure I Can',
    field: 'RNAM',
    speaker_gender: 'any',
    translation: 'Ще не ясно, чи зможу.',
    bad: ['Не впевнений.', 'Не впевнена.'],
  },
  {
    source: 'I was a soldier.',
    speaker: 'Player',
    speaker_gender: 'any',
    translation: 'До війни — армія.',
    bad: ['Я був солдатом.', 'Я була солдатом.'],
  },
  {
    source: 'Are you ready?',
    addressee: 'Player',
    addressee_gender: 'any',
    translation: 'Ну що, рушаємо?',
    bad: ['Ти готовий?', 'Ти готова?', 'Ви готові?'],
  },
  {
    source: 'Be careful out there.',
    addressee: 'Player',
    addressee_gender: 'any',
    translation: 'Бережи себе.',
    bad: [
      'Будь обережною там. Будь обережним там.',
      'Будьте обережні.',
      'Будь обережним там.',
      'Будь обережним/обережною там.',
    ],
  },
  {
    source: 'Be careful.',
    addressee_gender: 'any',
    translation: 'Обережніше.',
    bad: ['Будь обережною. Будь обережним.', 'Будьте обережні.'],
  },
  {
    source: "come along whenever you're ready",
    addressee_gender: 'any',
    translation: 'Ну, рушай, як зможеш.',
    bad: ['коли будеш готовий', 'коли будете готові'],
  },
  {
    source: 'You first.',
    speaker_gender: 'any',
    translation: 'Тобі вперед.',
    bad: ['Ти перший.', 'Ти перша.', 'Тобі першою.'],
  },
  {
    source: 'Yeah, yeah, make with the jokes, but you still helped.',
    addressee_gender: 'any',
    translation: 'Та досить жартів, робота зроблена.',
    bad: ['але ти все одно допоміг.', 'але ти все одно допомогла.'],
  },
  {
    source: "It's your call.",
    speaker: 'Preston',
    addressee_gender: 'any',
    translation: 'Тобі вирішувати.',
    bad: ['Вам вирішувати.'],
  },
  {
    source: "You're different.",
    addressee_gender: 'any',
    translation: 'З тобою інакше.',
    bad: ['Ти інший.', 'Ти інша.'],
  },
  {
    source: 'You look tired.',
    addressee_gender: 'any',
    translation: 'Схоже, тобі нелегко.',
    bad: ['Ти виглядаєш стомленим.', 'Ти виглядаєш стомленою.'],
  },
  {
    source: "You're a two-faced liar!",
    addressee_gender: 'any',
    translation: 'Ти — дволична людина!',
    bad: ['Ти брехун!', 'Ти брехуха!'],
  },
  {
    source: "There's nothing you can say that's going to change my mind.",
    addressee_gender: 'any',
    translation: 'Нічого з того, що скажеш, не змінить думки.',
    bad: ['що б ти не сказав', 'що б ти не казала'],
  },
  {
    source: 'Nothing you say will change my mind.',
    addressee_gender: 'any',
    translation: 'Словами мене не зупиниш.',
    bad: ['що б ти не казав', 'що б ви не сказали'],
  },
  {
    source: 'You might be the only one who can.',
    addressee_gender: 'any',
    translation: 'Можливо, тут єдина людина, хто може.',
    bad: ['ти єдиний, хто може', 'ви тут єдина'],
  },
  {
    source: 'Where are you goin?',
    addressee_gender: 'any',
    translation: 'Куди це ти?',
    bad: ['Куди це ти зібрався?', 'Куди це ти зібралася?'],
  },
  {
    source: "Relax, you're free to go.",
    addressee_gender: 'female',
    translation: 'Заспокойся, ти вільна йти.',
  },
] as const;

/**
 * How to hide gender on a shared Nate/Nora line. Patterns, not a banned-word list.
 * Flipping «був» → «була» is the same leak.
 */
export const UK_WASTELAND_GENDER_RECAST_EXAMPLES = `### ЯК ХОВАТИ РІД (спільний рядок Нейта/Нори)
Не міняй чоловічий рід на жіночий і навпаки. Перепиши **конструкцію**. У рядку не лишай «я + минулий», «ти + прикметник», «сам/сама».
Не вгадуй стать з імені, професії, звання, тону чи «ймовірності» — лише \`speaker_gender\` / \`addressee_gender\` / канонічний спліт у source.
Спочатку **теперішній час** («чекаю», не «чекав»). Далі наказ, стан, іменник, результат. Канцелярит «попереджено» гірший за «тебе вже попереджали». Не міняй хто зробив що.
Поле "translation" — **ОДНА** репліка вголос. "bad" — антиприклади, не варіанти для копіювання.
Заборонено в translation: дві статі підряд, слеш «обережним/обережною», «ви»/«будьте» як милиця роду.
Адресат-NPC з \`male\`/\`female\` — узгоджуй рід як звичайно. Рід мовця \`male\`/\`female\` не ховай.

${promptJsonItems(UK_GENDER_RECAST_ITEMS)}`;

const UK_ENDEARMENT_VERIFY = `- «любий» / «люба» як пестливе звертання (не прикметник при іменнику на кшталт «любий дім») → **"suspicious"**; suggestion з «сонечко» / «золотко» / «серденько».
- Пестливе «сонечко» / «золотко» / «серденько» плюс маркована друга особа однини («ти міг», «ти допомогла», «ви прекрасна») при адресаті-гравці або unknown → **"suspicious"**; suggestion нейтралізує **весь** рядок, не лише звертання.`;

const endearmentTranslate = (register: UkPlayerRegister): string => {
  const recast =
    register === 'wasteland-ty'
      ? 'Перефразуй увесь присудок: теперішній час, наказ, безособове. Не ховай рід через «ви».'
      : 'Перефразуй увесь присудок: теперішній час, наказ, «ви»+множина або безособове.';
  const perfect =
    register === 'wasteland-ty'
      ? '"You\'re perfect, my dear." → «Оце так, золотко.»'
      : '"You\'re perfect, my dear." → «Ви прекрасні, золотко.»';
  return `- **Пестливі звертання** (honey, hon, sweetheart, sweetie, darling, darlin', dear, love, babe, baby): гендерно-нейтральні іменники «сонечко», «золотко», «серденько» — чергуй за тоном. НІКОЛИ «любий» / «люба» **до людини**. «my dear» → «моє сонечко» / «моє золотко» / «моє серденько». Якщо слово — прикметник до іменника («Home Sweet Home», «sweet girl», «любий Піп-бой») — звичайний прикметник, не звертання.
- **Весь рядок, не лише звертання**: у репліці ДО гравця (\`addressee_gender: "any"\`) або коли стать адресата невідома жодна форма другої особи не сміє маркувати рід — ні «ти міг би / ти допомогла / ти впевнена», ні «ви прекрасна». ${recast} "Thanks, honey. You were a big help." → «Дякую за допомогу, сонечко.»; "Hon, could you help me?" → «Сонечко, можеш допомогти?»; ${perfect} Якщо адресат — конкретний NPC з male/female, узгоджуй рід як звичайно.`;
};

const playerSecondPersonTranslate = (register: UkPlayerRegister): string => {
  if (register === 'wasteland-ty') {
    return `  - **Немає розвилки на стать** (\`any\` / RNAM / \`addressee_kind=player\` при порожньому gender) → не калькуй минулий час і прикметник («я був/згоден/звик», «ти готовий/міг», «знайшла», «сам»). Перепиши **весь** присудок: спочатку теперішній час без роду, далі наказ, стан, іменник, результат. Слэш «зробив/ла», дві статі в одному рядку («Будь обережною там. Будь обережним там.») і «ви»/«будьте» як милиця роду — заборонені. Не вгадуй стать з професії чи тону.
  - \`addressee_gender: "any"\` (адресат — гравець, \`addressee: "Player"\`; gender часто \`null\` — дивись \`addressee_kind\`/ім'я) → **до гравця**: «Ну що, рушаємо?», «От і слушно», «Усе готово?», «Тоді рушай», «Схоже, тобі нелегко» — не «Ти готовий/виглядаєш стомленим».
  - \`speaker_gender: "any"\` (\`speaker: "Player"\`) або \`kind=prompt\` / RNAM → **спільний рядок Нейта/Нори**: «Гаразд», «Передумано», «Так і є», «Це вже було звичкою», «Мені здавалося», «Зроблено», «Знаю» (теперішній), «До війни — армія». Не «Я сказав/згоден/радий/знав/звик/думав/повинен».
  - \`speaker_gender: "male"/"female"\` при \`speaker: "Player"\` → **стать-специфічна версія** (окремий INFO: дружина/чоловік, Шон→мама/тато): рід першої особи. Тут нейтралізувати не треба.
  - Лишай рід, коли EN саме розщеплює рядок: sir/mum, Шон→мама/тато, Cooke→Paul, Silver Shroud→Mistress of Mysteries, Cito man/lady.
${UK_WASTELAND_GENDER_RECAST_EXAMPLES}`;
  }
  return `  - \`addressee_gender: "any"\` (адресат — гравець, \`addressee: "Player"\`) → **репліка ДО гравця**: без маркованих форм другої особи однини («ти готовий/готова»); «ви»+множина («Ви готові?») або безособовий перефраз («Усе готово?»).
  - \`speaker_gender: "any"\` (\`speaker: "Player"\`) → **репліка гравця за замовчуванням**: без маркованих форм першої особи; безособовий перефраз або «ви»+множина.
  - \`speaker_gender: "male"/"female"\` при \`speaker: "Player"\` → **стать-специфічна версія гравця** (окремий INFO для Nate/Nora): переклади з відповідним родом першої особи.`;
};

const playerRegisterTranslate = (register: UkPlayerRegister): string =>
  register === 'wasteland-ty'
    ? `- **Звертання до гравця**: регістр «ти»/«ви» — за правилами гри (пустка на ти). Рід ховай перефразом, не ввічливістю. Слэш «зробив/ла» заборонено.`
    : `- **Звертання до гравця**: «ви» з формами множини («Ви готові?»), не «Ти готовий/готова?» — коли \`addressee_gender\` є \`any\` або поле відсутнє, а рядок звернений до гравця.`;

const playerSecondPersonVerify = (register: UkPlayerRegister): string => {
  if (register === 'wasteland-ty') {
    return `  - Немає розвилки: калька з родом («ти готовий», «я був/згоден/звик», слеш «зробив/ла», дві статі підряд, «ви»/«будьте» лише щоб сховати рід) → **"suspicious"**; suggestion — одна репліка без роду.
  - \`addressee_gender: "any"\` (\`addressee: "Player"\`) → **до гравця**: нейтральний «ти» або перефраз → "ok". «Ви» лише коли голос мовця цього вимагає (Інститут, штаб, Кодсворт-компаньйон).
  - \`speaker_gender: "any"\` (\`speaker: "Player"\`) / RNAM → маркована перша особа («я згоден/знала/звик/думав», також «я до цього звик») → **"suspicious"**.
  - \`speaker_gender: "male"/"female"\` при \`speaker: "Player"\` → відповідний рід першої особи → "ok". Не вимагай нейтралізувати розвилку.
  - Канонічні спліти (sir/mum, Шон→мама/тато, Cooke→Paul, Silver Shroud→Mistress, Cito man/lady) — рід OK, не нейтралізуй.
  - Suggestion має переписати присудок, як у вдалих перефразах (не «був»→«була»).
${UK_WASTELAND_GENDER_RECAST_EXAMPLES}`;
  }
  return `  - \`addressee_gender: "any"\` (\`addressee: "Player"\`) → репліка **до гравця**: маркована друга особа однини («ти готовий/готова») → **"suspicious"**; «ви»+множина або безособовий перефраз → "ok".
  - \`speaker_gender: "any"\` (\`speaker: "Player"\`) → репліка **гравця**: маркована перша особа → **"suspicious"**, якщо це не стать-специфічна версія.
  - \`speaker_gender: "male"/"female"\` при \`speaker: "Player"\` → стать-специфічна версія гравця: відповідний рід першої особи → "ok".`;
};

const yourToPlayer = (register: UkPlayerRegister): string =>
  register === 'wasteland-ty'
    ? `- **«your» до гравця**: «твій/твоя/твоє» узгоджуй з **іменником** («Твоє повернення», «твій Піп-бой»), не з невидимою статтю гравця. Або іменник без присвійника. Не «Твій повернення», не «ваші» як милиця.`
    : `- **«your» до гравця**: «ваші», нейтральний іменник («Зброя в інвентарі») або перефраз без присвійника.`;

/**
 * Gender rules for a translation prompt.
 *
 * @param playerLabel - The game's player character in Ukrainian nominative,
 * e.g. «Драконоборець». Kept for call-site clarity.
 * @param register - Second-person default. Fallout 4 uses \`wasteland-ty\`.
 */
export const buildUkGenderTranslateRules = (
  playerLabel: string,
  register: UkPlayerRegister = 'formal-vy',
): string =>
  `- **Рід за метаданими (КРИТИЧНО, ${playerLabel})**: поля \`speaker\`, \`speaker_gender\`, \`addressee\`, \`addressee_gender\` задають хто говорить і до кого. У будь-якому grup, де вони є (INFO, DIAL, і репліки «you» в BOOK/QUST/MESG/TERM).
  - \`speaker_gender: "male"\` → перша особа в чоловічому роді: «я був», «я сказав», «я готовий».
  - \`speaker_gender: "female"\` → перша особа в жіночому роді: «я була», «я сказала», «я готова».
  - \`addressee_gender: "male"/"female"\` → друга особа однини узгоджується так само: «ти впевнений» / «ти впевнена».
${playerSecondPersonTranslate(register)}
  - \`"unknown"\` чи поле відсутнє — не вгадуй: нейтральна конструкція (безособове, інфінітив, іменник, «треба…»), **не** чоловічий рід «за замовчуванням».
  - Метадані сильніші за здогад із source: при \`speaker_gender: "female"\` "I was ready" → «Я була готова», а не безособовий перефраз.
  - Поля \`speaker\` і \`addressee\` дають імена учасників — використовуй для кличного відмінка та тону, не додавай їх у переклад.
${playerRegisterTranslate(register)}
${endearmentTranslate(register)}
- **Третя особа**: невідомі they/someone → «хтось», пасив, безособове — не «він/вона» без підказки в source, \`context\` чи метаданих.
${yourToPlayer(register)}`;

/** Gender rules for a verification prompt. */
export const buildUkGenderVerifyRules = (
  playerLabel: string,
  register: UkPlayerRegister = 'formal-vy',
): string =>
  `- **Рід за метаданими (КРИТИЧНО, ${playerLabel})**: звіряй рід у translation з \`speaker\`, \`speaker_gender\`, \`addressee\`, \`addressee_gender\` — у будь-якому grup, де поля є.
  - Розбіжність із "male"/"female" → **"incorrect"**: «я була» при \`speaker_gender: "male"\`, «ти готовий» при \`addressee_gender: "female"\`.
${playerSecondPersonVerify(register)}
  - \`"unknown"\` чи поле відсутнє: чоловічий рід «за замовчуванням» без підказки в source → "suspicious"; коректний нейтральний перефраз → "ok".
  - Якщо метадані задають рід, а переклад безособовий і природний — це "ok"; не переписуй його на гендерований без потреби.
  - Поля \`speaker\` і \`addressee\` — імена учасників: перевіряй кличний відмінок, але не вимагай додавати імена в переклад.
${UK_ENDEARMENT_VERIFY}`;
