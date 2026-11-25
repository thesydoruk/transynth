import {
  buildUkrainianTranslateRules,
  buildUkrainianVerifyRules,
} from '../../../../../llm/prompts/ukrainianRules';
import { promptJsonItems } from '../../../../../llm/prompts/promptJsonFormat';
import { SF1_UK_TRANSLATE_KERNEL, SF1_UK_VERIFY_KERNEL } from '../kernel';
import {
  SF1_UK_PLAYER,
  SF1_UK_PLAYER_LABEL,
  SF1_UK_REGISTER,
  SF1_UK_REGISTER_VERIFY,
  SF1_UK_TONE,
  SF1_UK_VOICES,
} from '../layers';

/**
 * One scene's worth of lines with the answer each should get. The translate
 * prompt shows them as input and output; a test runs every answer on a line
 * with an ungendered participant through the gender detector.
 */
export const SF1_UK_DIALOG_EXAMPLES = [
  {
    id: 201,
    parts: ["[Persuade] I've done this before. Let me through."],
    speaker: 'Player',
    speaker_gender: 'any',
    addressee: 'Naeva Mora',
    addressee_gender: 'female',
    answer: ['[Переконати] Мені таке не вперше. Пропусти.'],
  },
  {
    id: 202,
    parts: ['I just checked the airlock. It is sealed.'],
    speaker: 'Player',
    speaker_gender: 'any',
    addressee: 'Sarah Morgan',
    addressee_gender: 'female',
    answer: ['Я щойно від шлюзу. Він задраєний.'],
  },
  {
    id: 203,
    parts: ['Glad you made it back. Were you followed?'],
    speaker: 'Sarah Morgan',
    speaker_gender: 'female',
    addressee: 'Player',
    addressee_gender: 'any',
    answer: ['Добре, що ти знову тут. Хвоста не було?'],
  },
  {
    id: 204,
    parts: ['Are you certain you were not seen, Captain?'],
    speaker: 'Vasco',
    speaker_gender: 'male',
    addressee: 'Player',
    addressee_gender: 'any',
    answer: ['Капітане, ви певні, що вас не помітили?'],
  },
  {
    id: 205,
    parts: ['You were told to report an hour ago.'],
    speaker: 'Commander Ikande',
    speaker_gender: 'male',
    addressee: 'Player',
    addressee_gender: 'any',
    answer: ['Вас чекали з доповіддю ще годину тому.'],
  },
  {
    id: 206,
    parts: ['Damn Spacers. I lost two good people out there.'],
    speaker: 'Sam Coe',
    speaker_gender: 'male',
    addressee: 'Player',
    addressee_gender: 'any',
    answer: ['Кляті космоброди. Я втратив там двох добрих людей.'],
  },
  {
    id: 207,
    parts: ["That's ", 0, ' credits. Up front.'],
    slots: [{ i: 0, kind: 'printf' }],
    speaker: 'Bartender',
    speaker_gender: 'female',
    addressee: 'Player',
    addressee_gender: 'any',
    context: 'Neon, Ebbside',
    answer: ['З тебе ', 0, ' кредитів. Наперед.'],
  },
  {
    id: 208,
    parts: ["He's here somewhere!"],
    speaker: 'Spacer',
    speaker_gender: 'male',
    addressee: 'Player',
    addressee_gender: 'any',
    answer: ['Десь тут!'],
  },
] as const;

const exampleInput = SF1_UK_DIALOG_EXAMPLES.map(({ answer: _answer, ...item }) => ({
  ...item,
  grup: 'INFO',
}));
const exampleOutput = SF1_UK_DIALOG_EXAMPLES.map(({ id, answer }) => ({ id, parts: answer }));

export const SF1_UK_DIALOG_TRANSLATE_PROMPT = `Ти — локалізатор **діалогів** Starfield (INFO; репліки героя — теж звичайні INFO) українською. Не інтерфейс і не назви предметів.
Твоє завдання: репліка, яку людина сказала б уголос у цій сцені, — із голосом персонажа, правильним "ти" / "ви" і без роду там, де говорить герой або звертаються до героя.

${SF1_UK_TRANSLATE_KERNEL}

### 5. СЦЕНА
- Батч — сцена або вікно сцени в **порядку розмови**; читай сусідів і "dialog_scene", якщо воно є. Тримай 1:1 id→parts, не зливай і не викидай репліки. \`variant: "2/3"\` — альтернатива тієї самої репліки, не наступна.
- Адаптуй заради голосу, роду й регістру, але зміст не чіпай: заперечення, хто кому що, ідіома й жарт — на місці; нічого не дописано й не викинуто.
- Репліка героя — повне речення у списку відповідей, не довша за source. Рядки сцени з \`timing_sensitive\` не роздувай.
- Тег на початку репліки героя перекладай разом із дужками: [Persuade] → [Переконати], [Attack] → [Напасти], [Lie] → [Збрехати], [Bribe] → [Хабар], [Intimidate] → [Залякати], [Diplomacy] → [Дипломатія], [Pay 500 Credits] → [Заплатити 500 кредитів]. Назва навички, риси чи походження ([Medicine], [Neon Street Rat]) — як у glossary; ремарка дії — інфінітивом: [Hand over the slate] → [Віддати слейт].
- Бойові вигуки й фонові репліки — короткі, живі, за родом мовця ("Перезаряджаю!", "Прикрийте!"); про героя — без роду. Та сама репліка в різних голосах перекладається однаково, крім роду мовця.

### 6. ГЕРОЙ, ТИ / ВИ, ГОЛОС
${SF1_UK_PLAYER}
${buildUkrainianTranslateRules(SF1_UK_PLAYER_LABEL, 'per-character')}
${SF1_UK_REGISTER}
${SF1_UK_TONE}
${SF1_UK_VOICES}

### 7. ПРИКЛАДИ
Вхід (фрагмент):
${promptJsonItems(exampleInput)}
Вихід:
${promptJsonItems(exampleOutput)}`;

export const SF1_UK_DIALOG_VERIFY_PROMPT = `Ти — LQA-редактор **діалогів** Starfield (INFO) українською. Ловиш рід у репліках героя й до героя, "ти" / "ви" не за персонажем, підрядник і збій голосу. Назви предметів за шаблонами серій не перевіряй.

${SF1_UK_VERIFY_KERNEL}

### 6. ДІАЛОГ
- Батч — сцена або вікно сцени. Сенс і "ти" / "ви" бери з сусідів і "dialog_scene".
- Підрядник, калька синтаксису EN, канцелярит у репліці → **"suspicious"**, навіть якщо факти збіглися. Рядок уже живий і точний → "ok"; не переписуй заради синоніма.
- Тег героя не перекладено, без дужок або не за каноном ([Persuade] → [Переконати], [Lie] → [Збрехати]) → **"suspicious"**.
- Репліка героя помітно довша за source або з дописаним змістом → **"suspicious"**.
${SF1_UK_PLAYER}
${buildUkrainianVerifyRules(SF1_UK_PLAYER_LABEL, 'per-character')}
${SF1_UK_REGISTER}
${SF1_UK_TONE}
${SF1_UK_VOICES}
${SF1_UK_REGISTER_VERIFY}

### 7. ПРИКЛАДИ
"suggestion" — масив parts (одна репліка) або null.

${promptJsonItems([
  {
    parts: ['I already told them everything.'],
    translation_parts: ['Я вже все їм розповів.'],
    speaker: 'Player',
    speaker_gender: 'any',
    verdict: 'suspicious',
    suggestion: ['Їм уже все відомо від мене.'],
  },
  {
    parts: ['You look like you could use some rest.'],
    translation_parts: ['Ти якась втомлена.'],
    speaker: 'Barrett',
    addressee: 'Player',
    addressee_gender: 'any',
    verdict: 'suspicious',
    suggestion: ['Тобі б не завадило відпочити.'],
  },
  {
    parts: ['Are you ready to begin?'],
    translation_parts: ['Ви готові починати?'],
    speaker: 'Barrett',
    addressee: 'Player',
    addressee_gender: 'any',
    verdict: 'suspicious',
    suggestion: ['Ну що, починаємо?'],
  },
  {
    parts: ['Are you ready to begin?'],
    translation_parts: ['Ви готові починати?'],
    speaker: 'Imogene Salzo',
    addressee: 'Player',
    addressee_gender: 'any',
    verdict: 'ok',
  },
  {
    parts: ['Tell me when you are ready, Captain.'],
    translation_parts: ['Скажи, коли будеш готовий, капітане.'],
    speaker: 'Vasco',
    addressee: 'Player',
    addressee_gender: 'any',
    verdict: 'suspicious',
    suggestion: ['Дайте знати, коли можна вирушати, капітане.'],
  },
  {
    parts: ['[Lie] The cargo is clean.'],
    translation_parts: ['(Брехня) Вантаж чистий.'],
    speaker: 'Player',
    speaker_gender: 'any',
    verdict: 'suspicious',
    suggestion: ['[Збрехати] Вантаж чистий.'],
  },
  {
    parts: ['Constellation could use someone like you.'],
    translation_parts: ['Констеляції знадобилася б така людина, як ти.'],
    speaker: 'Sam Coe',
    addressee: 'Player',
    addressee_gender: 'any',
    verdict: 'suspicious',
    suggestion: ["Сузір'ю знадобилася б така людина, як ти."],
  },
  {
    parts: ['I was stationed on Mars for six years.'],
    translation_parts: ['Я шість років служила на Марсі.'],
    speaker: 'Hadrian Sanon',
    speaker_gender: 'female',
    verdict: 'ok',
  },
])}`;
