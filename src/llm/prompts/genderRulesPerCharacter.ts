/**
 * The `per-character` player register: the game-neutral twin of `wasteland-ty`.
 *
 * Same logic — the player's gender is hidden by recasting the line, never by
 * switching to the polite plural — with nothing that belongs to one game: no
 * character names, no setting, and the «ти» / «ви» choice left to the game's own
 * per-character rules. The wording of the two older registers is measured on
 * the Fallout 4 corpus and must not move, so this one lives beside them rather
 * than inside them.
 */

import { promptJsonItems } from './promptJsonFormat';

/** Few-shot recasts; every `translation` has to pass the gender detector. */
export const UK_PER_CHARACTER_GENDER_RECAST_ITEMS = [
  {
    source: 'I agree.',
    speaker: 'Player',
    speaker_gender: 'any',
    translation: 'Згода.',
    bad: ['Я згоден.', 'Я згодна.'],
  },
  {
    source: "I didn't know that.",
    speaker: 'Player',
    speaker_gender: 'any',
    translation: 'Для мене це новина.',
    bad: ['Я цього не знав.', 'Я цього не знала.'],
  },
  {
    source: 'I came alone.',
    speaker: 'Player',
    speaker_gender: 'any',
    translation: 'Зі мною нікого.',
    bad: ['Я прийшов сам.', 'Я прийшла сама.'],
  },
  {
    source: "I'm new here.",
    speaker: 'Player',
    speaker_gender: 'any',
    translation: 'Я тут уперше.',
    bad: ['Я тут новенький.', 'Я тут новенька.'],
  },
  {
    source: 'Are you ready?',
    addressee: 'Player',
    addressee_gender: 'any',
    note: 'мовець на «ти»',
    translation: 'Можемо починати?',
    bad: ['Ти готовий?', 'Ти готова?', 'Ви готові?'],
  },
  {
    source: 'Are you ready?',
    addressee: 'Player',
    addressee_gender: 'any',
    note: 'мовець на «ви»',
    translation: 'Ви готові?',
    bad: ['Ви готовий?', 'Ви готова?', 'Ти готовий?'],
  },
  {
    source: 'You were right.',
    addressee: 'Player',
    addressee_gender: 'any',
    translation: 'Твоя правда.',
    bad: ['Ти був правий.', 'Ти мала рацію.'],
  },
  {
    source: "You've done this before?",
    addressee: 'Player',
    addressee_gender: 'any',
    translation: 'Тобі таке вже доводилося робити?',
    bad: ['Ти вже таке робив?', 'Ти вже таке робила?'],
  },
  {
    source: 'Stay safe out there.',
    addressee: 'Player',
    addressee_gender: 'any',
    translation: 'Бережи себе там.',
    bad: ['Будь обережним.', 'Будь обережною. Будь обережним.', 'Будь обережним/обережною.'],
  },
  {
    source: 'I saw it with my own eyes.',
    speaker_gender: 'female',
    translation: 'Я бачила це на власні очі.',
  },
] as const;

const RECAST_ITEMS = promptJsonItems(UK_PER_CHARACTER_GENDER_RECAST_ITEMS);

export const UK_PER_CHARACTER_SECOND_PERSON_TRANSLATE = `  - \`addressee_gender: "any"\` (\`addressee: "Player"\`) → **репліка до гравця**; \`speaker_gender: "any"\` (\`speaker: "Player"\`) → **спільний рядок гравця**. Розвилки на стать немає: жодної форми з родом — ні «я був/згоден/звик/сам», ні «ти готовий/могла/прийшов», ні роду «за замовчуванням».
  - Перепиши **весь** присудок, а не закінчення («був»→«була» — той самий витік): спочатку теперішній час («чекаю», не «чекав»), далі наказ, стан, іменник, результат, безособове. Суб'єкт можна перенести («На тебе вже звернули увагу», не «ти привернув»), але хто що зробив — не міняй.
  - Заборонено: слеш «зробив/ла», дві статі підряд («Будь обережною. Будь обережним.»), «ви»/«будьте» замість «ти» лише щоб сховати рід. Персонаж, який за правилами гри говорить на «ви», лишається на «ви» — у множині («ви готові», не «ви готовий/готова»).
  - \`speaker_gender: "male"/"female"\` при \`speaker: "Player"\` → **стать-специфічна версія** (гра дає окремий рядок): рід першої особи, не нейтралізуй. Так само лишай рід, коли EN сам розщеплює рядок (sir/ma'am, him/her, man/woman, brother/sister).
  - Стать — лише з полів і з розщеплення в source; не з імені, професії, звання чи тону.
  - Приклади: "translation" — **ОДНА** репліка; "bad" — антиприклади, не варіанти для копіювання.
${RECAST_ITEMS}`;

export const UK_PER_CHARACTER_REGISTER_TRANSLATE = `- **Звертання до гравця**: регістр «ти»/«ви» — за правилами гри для цього персонажа. Рід ховай перефразом, не ввічливістю.`;

export const UK_PER_CHARACTER_SECOND_PERSON_VERIFY = `  - \`addressee_gender: "any"\` (\`addressee: "Player"\`) або \`speaker_gender: "any"\` (\`speaker: "Player"\`) — розвилки на стать немає. Форма з родом («ти готовий», «я був/згоден/звик/радий»), слеш «зробив/ла», дві статі підряд, «ви»/«будьте» лише щоб сховати рід → **"suspicious"**; suggestion — одна репліка без роду з переписаним присудком (не «був»→«була»).
  - «Ти» без роду або перефраз → "ok". «Ви» — коли так говорить цей персонаж за правилами гри: множина («ви готові») → "ok", «ви готовий/готова» → **"suspicious"**.
  - \`speaker_gender: "male"/"female"\` при \`speaker: "Player"\` або рід, який EN сам розщеплює (sir/ma'am, him/her, man/woman, brother/sister), — рід OK, не вимагай нейтралізації.
  - Вдалі перефрази ("bad" — те, що треба ловити):
${RECAST_ITEMS}`;

export const UK_PER_CHARACTER_YOUR_TO_PLAYER = `- **«your» до гравця**: присвійник («твій/твоя/твоє» або «ваш/ваша/ваше» — за регістром персонажа) узгоджуй з **іменником** («Твоє повернення», «ваш вибір»), не з невидимою статтю гравця. Або іменник без присвійника.`;
