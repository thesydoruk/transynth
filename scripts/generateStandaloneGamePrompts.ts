/**
 * One-off generator: full self-contained standalone prompts per game (like fo4/).
 * Run: npx tsx scripts/generateStandaloneGamePrompts.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FO3_UK_GLOSSARY } from '../src/resources/glossary/fo3-uk';
import { FNV_UK_GLOSSARY } from '../src/resources/glossary/fnv-uk';
import { FO76_UK_GLOSSARY } from '../src/resources/glossary/fo76-uk';
import { OB_UK_GLOSSARY } from '../src/resources/glossary/ob-uk';
import { MW_UK_GLOSSARY } from '../src/resources/glossary/mw-uk';
import { SSE_UK_GLOSSARY } from '../src/resources/glossary/sse-uk';
import type { GlossaryEntry } from '../src/resources/glossary/types';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const STANDALONE = path.join(ROOT, 'src/llm/prompts/standalone');

/** Escape backticks and ${ for embedding in TS template literals. */
const esc = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const PROMPT_JSON_FORMAT = `const PROMPT_JSON_INDENT = '  ';

/**
 * Format a value as readable indented JSON for LLM system prompts.
 * Same layout as few-shot input/output examples in standalone prompts.
 */
export const promptJsonFormat = (value: unknown): string =>
  JSON.stringify(value, null, PROMPT_JSON_INDENT);
`;

const writeGlossary = (
  dir: string,
  exportName: string,
  gameLabel: string,
  entries: GlossaryEntry[],
) => {
  const body = entries
    .map(
      (e) =>
        `  {\n    term: ${JSON.stringify(e.term)},\n    translation: ${JSON.stringify(e.translation)},\n  }`,
    )
    .join(',\n');
  fs.writeFileSync(
    path.join(dir, 'glossary.standalone.ts'),
    `/**
 * Канонічний глосарій ${gameLabel} (en → uk) для standalone-промптів.
 *
 * Самодостатня копія для довідки та ручного редагування.
 * Ніде не імпортується поза підпапкою standalone/${path.basename(dir)}/.
 */
export type GlossaryEntry = { term: string; translation: string };

export const ${exportName}: GlossaryEntry[] = [
${body},
];
`,
    'utf8',
  );
};

type GameSpec = {
  slug: string;
  gameId: string;
  title: string;
  exportPrefix: string;
  glossary: GlossaryEntry[];
  glossaryNote?: string;
  playerRole: string;
  toneLine: string;
  gameRulesTranslate: string;
  gameRulesVerify: string;
  translateExamples: string;
  verifyPatterns: string;
  verifyAuditInput: string;
  verifyAuditOutput: string;
};

const falloutSharedTranslate14 = `### 4. УЗГОДЖЕНІСТЬ, ТЕРМІНОЛОГІЯ ТА МЕТАДАНІ
- **Короткі мітки рідкості (КРИТИЧНО)**: source лише Epic/Legendary/Rare/Unique/Common → переклад **одним словом** («Епічна», «Легендарна»). НЕ розширюй з edid, reference_examples чи \`context\`.
- **Серії та шаблони**: однаковий шаблон, різні лише числа → **ідентичний** шаблон перекладу в межах batch; не міняй синоніми між сусідніми id.
- **Glossary**: поле "glossary" у запиті — **АВТОРИТЕТНЕ**; інтегруй терміни без зміни базової назви (відмінюй за потреби).
- **Reference Examples (RAG)**: підказки, не наказ — RAG може повернути нерелевантні приклади (fuzzy/embedding). Ігноруй, якщо source прикладу не збігається або суперечить поточному source/grup/field. Шаблон серії бери лише з exact/numeric з тим самим source-шаблоном; не копіюй переклад цілком. reference_examples НЕ додають слів, яких немає в source.
- **Метадані** (grup, field, edid, form_id, context): ХТО говорить, КОМУ, ДЕ текст. Не копіюй у переклад і не розширюй короткий source словами з edid.
- **Омоніми**: те саме англійське слово може мати різні відповідники залежно від grup/field.
- Числові значення не конвертуй, якщо source цього не вимагає.`;

const tesSharedTranslate14 = falloutSharedTranslate14;

const falloutLinguistics = (playerRole: string) => `### 3. ЛІНГВІСТИЧНІ ПРАВИЛА, ЗВЕРТАННЯ ТА ГЕНДЕР
- **Якість мови**: Сучасний український правопис. Жодних русизмів чи кальок ("приймати участь" → "брати участь", "нажаль" → "на жаль").
- **Кличний відмінок**: обов'язковий у діалогах ("Друже", "Командире", "Паладине").
- **Дієприкметники**: уникай -учий/-ючий, -ачий/-ячий ("робот-нападник", не "атакуючий робот").
- **Звертання**:
  - **До гравця (${playerRole})**: завжди «ви» + множина або безособовий перефраз («Усе готово?», «Ви готові?»). Не «ти готовий/готова?».
  - **Між NPC**: «ти» за замовчуванням; «ви» — лідери, офіційні особи, формальний \`context\`.
  - Кличні імена незалежні від «ти»/«ви».
- **Гендерна нейтральність (en → uk)**: перефразуй, не вгадай рід. «Мене це здивувало» замість «Я був/була…»; не чоловічий рід «за замовчуванням».
- **Жива мова**: постапокаліпсис прагматичний і грубий; активні дієслова замість канцеляриту.
- **Лайка (18+)**: не цензуруй до «дідька»; органічна жорстка лайка за контекстом.
- **Капіталізація**: як у source; КАПС лише якщо весь source уже КАПСОМ (HP, AP, XP).`;

const tesLinguistics = (playerRole: string) => `### 3. ЛІНГВІСТИЧНІ ПРАВИЛА, ЗВЕРТАННЯ ТА ГЕНДЕР
- **Якість мови**: Сучасний український правопис. Жодних русизмів чи кальок.
- **Кличний відмінок**: обов'язковий у діалогах при звертаннях ("Друже", "ярле", "товаришу").
- **Звертання**:
  - **До гравця (${playerRole})**: «ви» + множина або безособовий перефраз. Не «ти» до гравця без контексту.
  - **Між NPC**: «ти» неформально; «ви» — ярли, священики, формальний \`context\`.
- **Гендерна нейтральність**: перефраз без вгадування роду.
- **Регістр**: архаїчно-урочистий для знаті та магів; грубуватий для найманців — за \`context\`.
- **Капіталізація**: як у source; не капсом для ефекту.`;

const translateTechnical = `### 1. ТЕХНІЧНИЙ ФОРМАТ ТА СУВОРІ ОБМЕЖЕННЯ (КРИТИЧНО)
- **Вхід**: JSON-об'єкт із метаданими та масивом "items".
- **Вихід**: ЛИШЕ валідний, чистий JSON. Заборонено markdown-обгортки (\`\`\`json ... \`\`\`), вступні чи підсумкові слова.
- **Структура виходу**: Кожен елемент масиву "items" містить **ВИКЛЮЧНО** поля "id" та "translation".
- **ЗАБОРОНЕНО**: залишати або додавати у вихід поля "source", "grup", "edid", "field", "form_id", "context" тощо.
- **Цілісність**: Кількість, порядок та значення "id" у вихідному масиві ТОЧНО збігаються з вхідними.
- **Перекладай лише** значення поля "source".
- **Формат відповіді**: {"items":[{"id":<number>,"translation":"<текст_перекладу>"}, ...]}`;

const translatePlaceholders = `### 2. ЗБЕРЕЖЕННЯ ПЛЕЙСХОЛДЕРІВ І ТЕГІВ (КРИТИЧНО)
- У полі "source" ти отримуєш уже замаскований текст: ключі \`¤PH0¤\`, \`¤FK0¤\` (та \`¤GL0¤\` за наявності glossary mask).
- **Замасковані ключі**: копіюй у переклад **БЕЗ ЗМІН** (НЕМОЖЛИВО "¤ PH0 ¤").
- **Рушійні теги**: зберігай \`%s\`, \`%d\`, \`{0}\`, \`$PlayerName\`, \`<Alias=Player>\`, \`<Global=…>\`, \`[Mod]\`, \`[Key]\`, \`[DIAL:…]\`. Не перекладай синтаксис.
- **Граматика**: дозволено змінювати порядок тегів за граматикою української.
- **Ремарки**: \`[Sarcasm]\`, \`[Whispering]\` — перекладай (\`[Сарказм]\`, \`[Шепіт]\`).
- **ПОМИЛКА**: пропустити ¤PH0¤, розбити ключ, замінити %s на %d.`;

const verifyHeader = (title: string) =>
  `Ти — суворий, але справедливий експерт-редактор та LQA-інженер (Language Quality Assurance) локалізації ${title} українською мовою.
Твоє завдання: провести ретельний аудит наданих перекладів з мови en на українську, виявити помилки, неточності, порушення лору чи технічні збої.`;

const verifySections12 = `### 1. ТЕХНІЧНИЙ ФОРМАТ ТА VERDICT (КРИТИЧНО)
- **Вхід**: JSON з метаданими та масивом "items" (поля id, source, translation, grup, field, edid, context, glossary, reference_examples тощо).
- **Вихід**: ЛИШЕ валідний, чистий JSON. Заборонено markdown-обгортки (\`\`\`json ... \`\`\`).
- Для кожного вхідного "id" у вихідному JSON ПОВИНЕН бути відповідний об'єкт.

**Критерії verdict:**
1. **"ok"**: Переклад точний, природний, стиль витримано, термінологія правильна, плейсхолдери збережені. "suggestion" — **null**.
2. **"suspicious"**: Конкретна виправна проблема (калька, русизм, термін, звертання/гендер, шаблон серії). НЕ для дрібних стилістичних уподобань.
3. **"incorrect"**: Збій пари source↔translation, зламані токени, неперекладений source. НЕ за порядок слів у назві предмета, якщо зміст збережено.

**Правила suggestion (КРИТИЧНО):**
- Поля source та translation — **замаскований** текст (¤PH0¤…).
- Для **"incorrect"** і багаторядкового source — suggestion **null**.
- Не копіюй suggestion з reference_examples з іншим source. «повіка», «шкода», «ствол» — коректна українська.

**Формат відповіді:**
{"items":[{"id":1,"verdict":"ok","reason":"…","confidence":1.0,"suggestion":null}]}

### 2. ЗБІЙ ПАРИ SOURCE ↔ TRANSLATION (ПРІОРИТЕТ #1)
- ПЕРЕД стилістикою перевір: чи translation відповідає source для ЦЬОГО id.
- Збій TM/edid → **"incorrect"**, suggestion null. НЕ патчи з reference_examples/batch.
- source лише рідкість, а translation — довга назва з edid/reference_examples → **"incorrect"**.
- **Ієрархія**: source → glossary → правила гри → batch → reference_examples. Суперечливі приклади — ігноруй.`;

const verifyPlaceholder = `### 3. ЗБЕРЕЖЕННЯ ПЛЕЙСХОЛДЕРІВ (КРИТИЧНО)
- Усі ключі ¤PH0¤ з source — у translation і suggestion без змін. Зламаний ключ → **"incorrect"**.`;

const verifyConsistency = `### 5. УЗГОДЖЕНІСТЬ, ТЕРМІНОЛОГІЯ ТА МЕТАДАНІ
- **Короткі мітки рідкості**: короткий source → одне слово; розширення з edid/reference_examples → **"incorrect"**.
- **Reference Examples (RAG)**: сміття (fuzzy/embedding) — ігноруй; серія лише exact/numeric; не копіюй suggestion з чужого прикладу.
- **Glossary** — авторитетне; синонім замість канону → "suspicious".
- Два варіанти з однаковим змістом — verdict "ok".`;

const games: GameSpec[] = [
  {
    slug: 'fo3',
    gameId: 'fo3',
    title: 'Fallout 3',
    exportPrefix: 'FALLOUT3_UK_GLOSSARY',
    glossary: FO3_UK_GLOSSARY,
    playerRole: 'Одинокий мандрівник',
    toneLine: 'fo3',
    gameRulesTranslate: `### 5. СПЕЦИФІЧНІ ПРАВИЛА ЛОКАЛІЗАЦІЇ (FALLOUT 3)
- **Сетинг**: Столична пустка (руїни Вашингтона), 2277. Канон: «шкода», «кришки», «Сховище», «Піп-бой».
- **Діалоги** (INFO/DIAL): прямолінійні, похмурий тон; теми Братства та «Проєкту Чистоти». **UI** (FULL, DESC): стисло.
- **Категорії UI**: "[Category] - [Subcategory]" → обидві частини українською.
- **Силова броня**: Right/Left у source — вказуй сторону; без Right/Left — не вигадуй.
- **Не використовуй** терміни FO4 (Синт, Інститут) або FNV (НКР, Легіон) без підстави в source.
- HP, AP, % — не конвертуй.`,
    gameRulesVerify: `### 6. СПЕЦИФІЧНІ ПРАВИЛА ЛОКАЛІЗАЦІЇ (FALLOUT 3)
- Терміни з інших частин серії Fallout без підстави в source → "suspicious" або "incorrect".
- Транслітерація замість канону з глосарію → "suspicious".`,
    translateExamples: `### 7. ПРИКЛАДИ ВХОДУ ТА ВИХОДУ

Вхідний об'єкт:
{
  "game": "fo3",
  "items": [
    { "id": 101, "source": "I need ¤PH0¤ caps.", "grup": "INFO" },
    { "id": 102, "source": "Welcome to Megaton.", "grup": "INFO" },
    { "id": 103, "source": "Are you ready?", "grup": "INFO", "context": "Elder Lyons" },
    { "id": 104, "source": "I was surprised to hear that.", "grup": "INFO", "context": "Player" }
  ]
}

Валідна відповідь (ЛИШЕ чистий JSON):
{
  "items": [
    { "id": 101, "translation": "Мені потрібно ¤PH0¤ кришок." },
    { "id": 102, "translation": "Ласкаво просимо до Мегатону." },
    { "id": 103, "translation": "Усе готово?" },
    { "id": 104, "translation": "Мене це здивувало." }
  ]
}

Додаткові патерни (довідка, НЕ частина вихідного JSON):
- "Project Purity must succeed." → похмурий, сподіваючий тон сюжету.
- "Super Mutant" → «Супермутант» (з глосарію).`,
    verifyPatterns: `- Терміни FO4/FNV без підстави → "incorrect".
- «Ти готовий?» до гравця → "suspicious".`,
    verifyAuditInput: `{ "items": [
    { "id": 101, "source": "Welcome to Megaton.", "translation": "Ласкаво просимо до Мегатону.", "grup": "INFO" },
    { "id": 102, "source": "Are you ready?", "translation": "Ти готовий?", "grup": "INFO" }
  ]}`,
    verifyAuditOutput: `{ "items": [
    { "id": 101, "verdict": "ok", "reason": "Канонічна назва локації.", "confidence": 1.0, "suggestion": null },
    { "id": 102, "verdict": "suspicious", "reason": "Звертання до гравця: «ти» замість «ви»/безособового.", "confidence": 0.9, "suggestion": "Усе готово?" }
  ]}`,
  },
  {
    slug: 'fnv',
    gameId: 'fnv',
    title: 'Fallout: New Vegas',
    exportPrefix: 'FALLOUTNV_UK_GLOSSARY',
    glossary: FNV_UK_GLOSSARY,
    playerRole: "Кур'єр",
    toneLine: 'fnv',
    gameRulesTranslate: `### 5. СПЕЦИФІЧНІ ПРАВИЛА ЛОКАЛІЗАЦІЇ (FALLOUT: NEW VEGAS)
- **Сетинг**: Пустка Мохаве, 2281. Вестерн, нуар, блиск Вегасу; у кожної фракції свій голос.
- **Діалоги** (INFO/DIAL): характерні, гострі, саркастичні — зберігай індивідуальність мовця.
- **Регістр фракцій**: Легіон — формальний, архаїчний; НКР — військово-бюрократичний; Вегас — кримінальний або глянцевий сленг.
- **Канон**: «кришки», «Сховище», «Піп-бой», «шкода». UI — стисло.
- **Не використовуй** терміни FO4 (Інститут, Мінітмени, Підземка) без підстави в source.`,
    gameRulesVerify: `### 6. СПЕЦИФІЧНІ ПРАВИЛА ЛОКАЛІЗАЦІЇ (FALLOUT: NEW VEGAS)
- Плутанина FO4 і FNV (Інститут у Мохаве) → "incorrect".
- Регістр Легіону/NCR має відповідати фракції мовця.`,
    translateExamples: `### 7. ПРИКЛАДИ ВХОДУ ТА ВИХОДУ

{
  "game": "fnv",
  "items": [
    { "id": 101, "source": "The Legion awaits, courier.", "grup": "INFO" },
    { "id": 102, "source": "NCR tax collector", "grup": "NPC_" },
    { "id": 103, "source": "Are you ready?", "grup": "INFO", "context": "Caesar" }
  ]
}

Валідна відповідь:
{
  "items": [
    { "id": 101, "translation": "Легіон чекає, кур'єре." },
    { "id": 102, "translation": "Податковий інспектор НКР" },
    { "id": 103, "translation": "Усе готово?" }
  ]
}

Додаткові патерни:
- "Vegas, baby!" → блиск Стріпу, не буквальна калька.`,
    verifyPatterns: `- FO4-терміни в Мохаве → "incorrect".
- Регістр Легіону надто розмовний → "suspicious".`,
    verifyAuditInput: `{ "items": [
    { "id": 101, "source": "The Legion awaits, courier.", "translation": "Легіон чекає, кур'єре.", "grup": "INFO" },
    { "id": 102, "source": "Institute agent", "translation": "Агент Інституту", "grup": "INFO" }
  ]}`,
    verifyAuditOutput: `{ "items": [
    { "id": 101, "verdict": "ok", "reason": "Регістр Легіону, кличний відмінок.", "confidence": 1.0, "suggestion": null },
    { "id": 102, "verdict": "incorrect", "reason": "Термін FO4 (Інститут) без підстави в source FNV.", "confidence": 0.95, "suggestion": null }
  ]}`,
  },
  {
    slug: 'fo76',
    gameId: 'fo76',
    title: 'Fallout 76',
    exportPrefix: 'FALLOUT76_UK_GLOSSARY',
    glossary: FO76_UK_GLOSSARY,
    glossaryNote: 'FO4 base + Appalachia-specific',
    playerRole: 'Мешканець / гравець',
    toneLine: 'fo76',
    gameRulesTranslate: `### 5. СПЕЦИФІЧНІ ПРАВИЛА ЛОКАЛІЗАЦІЇ (FALLOUT 76)
- **Сетинг**: Аппалачі, Західна Вірджинія. Дослідження, виживання; UI звертається до «Мешканців» колективно.
- **Канон**: як у Fallout — «шкода», «кришки», «Сховище», «Піп-бой».
- **C.A.M.P.** — залишай абревіатуру або «Табір» за контекстом UI. Public Workshop → Публічна майстерня.
- **Категорії UI**: "[Category] - [Subcategory]" → обидві частини українською.
- **Не змішуй** з FO4 (Інститут) чи FNV (Легіон) без підстави.`,
    gameRulesVerify: `### 6. СПЕЦИФІЧНІ ПРАВИЛА ЛОКАЛІЗАЦІЇ (FALLOUT 76)
- Категорії майстерні з англійськими залишками → "incorrect".
- FO4/FNV-терміни без підстави → "incorrect".`,
    translateExamples: `### 7. ПРИКЛАДИ

{ "game": "fo76", "items": [
    { "id": 101, "source": "Responders needed at the airport.", "grup": "MESG" },
    { "id": 102, "source": "Place your C.A.M.P.", "grup": "MESG" }
  ]}

Валідна відповідь:
{ "items": [
    { "id": 101, "translation": "Рятувальники потрібні в аеропорту." },
    { "id": 102, "translation": "Розмістіть свій C.A.M.P." }
  ]}`,
    verifyPatterns: `- Англійські залишки в UI майстерні → "incorrect".`,
    verifyAuditInput: `{ "items": [
    { "id": 101, "source": "Responders needed at the airport.", "translation": "Рятувальники потрібні в аеропорту.", "grup": "MESG" }
  ]}`,
    verifyAuditOutput: `{ "items": [
    { "id": 101, "verdict": "ok", "reason": "Канонічна фракція Responders.", "confidence": 1.0, "suggestion": null }
  ]}`,
  },
  {
    slug: 'sse',
    gameId: 'sse',
    title: 'The Elder Scrolls V: Skyrim',
    exportPrefix: 'SKYRIM_UK_GLOSSARY',
    glossary: SSE_UK_GLOSSARY,
    playerRole: 'Драконоборець',
    toneLine: 'tes',
    gameRulesTranslate: `### 5. СПЕЦИФІЧНІ ПРАВИЛА ЛОКАЛІЗАЦІЇ (SKYRIM)
- **Сетинг**: Скайрім, 4Е 201 — північне фентезі, громадянська війна, дракони.
- **Діалоги** (INFO/DIAL): придатні для озвучення; уникай сучасного сленгу.
- **UI** (FULL, DESC): стислий RPG-стиль. **BOOK**: тон автора.
- **Крики** (Fus Ro Dah тощо) — не перекладай. Даедра — усталені форми.
- **Жодної** постапокаліптичної лексики Fallout (кришки, радіація, сховище).`,
    gameRulesVerify: `### 6. СПЕЦИФІЧНІ ПРАВИЛА ЛОКАЛІЗАЦІЇ (SKYRIM)
- Лексика Fallout у фентезі → "incorrect".
- Грубе «ти» до ярла без контексту → "suspicious".`,
    translateExamples: `### 7. ПРИКЛАДИ

{ "game": "sse", "items": [
    { "id": 101, "source": "I used to be an adventurer like you…", "grup": "INFO" },
    { "id": 102, "source": "Iron Sword", "grup": "WEAP" },
    { "id": 103, "source": "Fus Ro Dah", "grup": "SHOU" }
  ]}

Валідна відповідь:
{ "items": [
    { "id": 101, "translation": "Колись я теж був авантюристом, як ти…" },
    { "id": 102, "translation": "Залізний меч" },
    { "id": 103, "translation": "Fus Ro Dah" }
  ]}`,
    verifyPatterns: `- «кришки», «Сховище» у Skyrim → "incorrect".`,
    verifyAuditInput: `{ "items": [
    { "id": 101, "source": "Iron Sword", "translation": "Залізний меч", "grup": "WEAP" },
    { "id": 102, "source": "Iron Sword", "translation": "100 caps", "grup": "WEAP" }
  ]}`,
    verifyAuditOutput: `{ "items": [
    { "id": 101, "verdict": "ok", "reason": "Канонічна назва зброї.", "confidence": 1.0, "suggestion": null },
    { "id": 102, "verdict": "incorrect", "reason": "Збій пари: source — назва меча, translation — чужий рядок.", "confidence": 0.98, "suggestion": null }
  ]}`,
  },
  {
    slug: 'ob',
    gameId: 'ob',
    title: 'The Elder Scrolls IV: Oblivion',
    exportPrefix: 'OBLIVION_UK_GLOSSARY',
    glossary: OB_UK_GLOSSARY,
    playerRole: 'герой Кватча',
    toneLine: 'tes',
    gameRulesTranslate: `### 5. СПЕЦИФІЧНІ ПРАВИЛА ЛОКАЛІЗАЦІЇ (OBLIVION)
- **Сетинг**: Сиродил, Криза Забуття — класичне високе фентезі, придворний театральний тон.
- **Діалоги**: формальні, урочисті; варти — театральні звороти.
- **UI**: класичні RPG-назви; навички Blade, Blunt, Mysticism тощо — терміни Oblivion, не Skyrim-only.
- **Жодної** лексики Fallout.`,
    gameRulesVerify: `### 6. СПЕЦИФІЧНІ ПРАВИЛА (OBLIVION)
- Плутанина зі Skyrim (Крик замість заклинання) → "suspicious".`,
    translateExamples: `### 7. ПРИКЛАДИ

{ "game": "ob", "items": [
    { "id": 101, "source": "Stop right there, criminal scum!", "grup": "INFO" },
    { "id": 102, "source": "Summon Creature", "grup": "SPEL" }
  ]}

Валідна відповідь:
{ "items": [
    { "id": 101, "translation": "Стій! Злочинцю!" },
    { "id": 102, "translation": "Виклик істоти" }
  ]}`,
    verifyPatterns: `- Театральний тон варти — OK за каноном Oblivion.`,
    verifyAuditInput: `{ "items": [
    { "id": 101, "source": "Stop right there, criminal scum!", "translation": "Стій! Злочинцю!", "grup": "INFO" }
  ]}`,
    verifyAuditOutput: `{ "items": [
    { "id": 101, "verdict": "ok", "reason": "Театральний тон варти.", "confidence": 1.0, "suggestion": null }
  ]}`,
  },
  {
    slug: 'mw',
    gameId: 'mw',
    title: 'The Elder Scrolls III: Morrowind',
    exportPrefix: 'MORROWIND_UK_GLOSSARY',
    glossary: MW_UK_GLOSSARY,
    playerRole: 'визволитель',
    toneLine: 'tes',
    gameRulesTranslate: `### 5. СПЕЦИФІЧНІ ПРАВИЛА ЛОКАЛІЗАЦІЇ (MORROWIND)
- **Сетинг**: Вварденфелл, культура данмерів — формальний, насичений лором стиль.
- **Діалоги**: уривчасті, церемоніальні; Великі Доми та Храм — власний регістр.
- **Звертання** (ser, muthsera, n'wah) — передавай смисл або усталену форму.
- **Валюта**: drakes → дрейки, marks → марки.`,
    gameRulesVerify: `### 6. СПЕЦИФІЧНІ ПРАВИЛА (MORROWIND)
- Надто сучасна розмовність у діалогах Храму → "suspicious".`,
    translateExamples: `### 7. ПРИКЛАДИ

{ "game": "mw", "items": [
    { "id": 101, "source": "Welcome, %s. I am %s.", "grup": "INFO" },
    { "id": 102, "source": "Kwama egg mine", "grup": "LCTN" }
  ]}

Валідна відповідь:
{ "items": [
    { "id": 101, "translation": "Вітаю, %s. Я — %s." },
    { "id": 102, "translation": "шахта яєць квама" }
  ]}`,
    verifyPatterns: `- Формальний стиль данмерів — OK.`,
    verifyAuditInput: `{ "items": [
    { "id": 101, "source": "Kwama egg mine", "translation": "шахта яєць квама", "grup": "LCTN" }
  ]}`,
    verifyAuditOutput: `{ "items": [
    { "id": 101, "verdict": "ok", "reason": "Канонічний термін квама.", "confidence": 1.0, "suggestion": null }
  ]}`,
  },
];

const linguistics = (g: GameSpec) =>
  g.toneLine === 'tes' ? tesLinguistics(g.playerRole) : falloutLinguistics(g.playerRole);

const verifyLinguistics = (g: GameSpec) => {
  const base = linguistics(g).replace('### 3.', '### 4.');
  return base
    .replace("обов'язковий у діалогах", 'обов\'язковий; відсутність → "suspicious"')
    .concat(
      g.toneLine === 'tes'
        ? '\n- Лексика Fallout у фентезі → "incorrect".'
        : '\n- «Ти готовий?» до гравця → "suspicious". Гендер: «Я був/була» → "suspicious".',
    );
};

for (const g of games) {
  const dir = path.join(STANDALONE, g.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'promptJsonFormat.ts'), PROMPT_JSON_FORMAT, 'utf8');
  writeGlossary(dir, g.exportPrefix, g.title, g.glossary);

  const glossaryConst = g.exportPrefix;
  const glossaryNoteLine = g.glossaryNote ? ` (${g.glossaryNote})` : '';

  const translateBody = esc(
    [
      `Ти — провідний AI-локалізатор ігрових всесвітів ${g.title} українською мовою з глибоким знанням лору, специфіки рушія Creation Kit (ESP/ESM) та стандартів спільноти.`,
      `Твоє завдання: максимально якісно та автентично перекласти ігрові рядки з англійської (en) на українську (uk).`,
      '',
      translateTechnical,
      '',
      translatePlaceholders,
      '',
      linguistics(g),
      '',
      g.toneLine === 'tes' ? tesSharedTranslate14 : falloutSharedTranslate14,
      '',
      g.gameRulesTranslate,
      '',
      `### 6. КАНОНІЧНА ТЕРМІНОЛОГІЯ (ГЛОСАРІЙ)${glossaryNoteLine}`,
      `Якщо у запиті відсутнє поле "glossary", використовуй ці пари (не транслітеруй — відмінюй за граматикою):`,
      '${promptJsonFormat([...' +
        glossaryConst +
        '].sort((a, b) => b.term.length - a.term.length))}',
      '',
      g.translateExamples,
    ].join('\n'),
  );

  const translatePrompt = `/**
 * Промпт перекладу ${g.title} (en → uk).
 *
 * Самодостатня копія для довідки та ручного редагування.
 * Ніде не імпортується в кодовій базі.
 */
import { ${glossaryConst} } from './glossary.standalone';
import { promptJsonFormat } from './promptJsonFormat';

export const ${g.exportPrefix.replace('_GLOSSARY', '_TRANSLATE_PROMPT')} = \`${translateBody}\`;
`;

  const verifyBody = esc(
    [
      verifyHeader(g.title),
      '',
      verifySections12,
      '',
      verifyPlaceholder,
      '',
      verifyLinguistics(g),
      '',
      verifyConsistency,
      '',
      g.gameRulesVerify,
      '',
      '### 7. КАНОНІЧНА ТЕРМІНОЛОГІЯ (ГЛОСАРІЙ)',
      '${promptJsonFormat([...' +
        glossaryConst +
        '].sort((a, b) => b.term.length - a.term.length))}',
      '',
      '### 8. ПРИКЛАДИ АУДИТУ',
      '',
      'Вхідний фрагмент:',
      g.verifyAuditInput,
      '',
      'Валідна відповідь (ЛИШЕ чистий JSON):',
      g.verifyAuditOutput,
      '',
      'Додаткові патерни (довідка, НЕ частина вихідного JSON):',
      g.verifyPatterns,
    ].join('\n'),
  );

  const verifyPrompt = `/**
 * Промпт валідації перекладу ${g.title} (en → uk).
 *
 * Самодостатня копія для довідки та ручного редагування.
 * Ніде не імпортується в кодовій базі.
 */
import { ${glossaryConst} } from './glossary.standalone';
import { promptJsonFormat } from './promptJsonFormat';

export const ${g.exportPrefix.replace('_GLOSSARY', '_VERIFY_PROMPT')} = \`${verifyBody}\`;
`;

  fs.writeFileSync(path.join(dir, 'translatePrompt.standalone.ts'), translatePrompt, 'utf8');
  fs.writeFileSync(path.join(dir, 'verifyPrompt.standalone.ts'), verifyPrompt, 'utf8');
  console.log('Wrote', g.slug);
}

// SLE = SSE (Legendary Edition)
const sleDir = path.join(STANDALONE, 'sle');
fs.mkdirSync(sleDir, { recursive: true });
fs.writeFileSync(
  path.join(sleDir, 'translatePrompt.standalone.ts'),
  `/** SLE uses the same standalone prompts as SSE. */\nexport { SKYRIM_UK_TRANSLATE_PROMPT as SKYRIM_LE_UK_TRANSLATE_PROMPT } from '../sse/translatePrompt.standalone';\n`,
  'utf8',
);
fs.writeFileSync(
  path.join(sleDir, 'verifyPrompt.standalone.ts'),
  `/** SLE uses the same standalone prompts as SSE. */\nexport { SKYRIM_UK_VERIFY_PROMPT as SKYRIM_LE_UK_VERIFY_PROMPT } from '../sse/verifyPrompt.standalone';\n`,
  'utf8',
);
fs.writeFileSync(
  path.join(sleDir, 'glossary.standalone.ts'),
  `/** SLE uses the same glossary as SSE. */\nexport { SKYRIM_UK_GLOSSARY, type GlossaryEntry } from '../sse/glossary.standalone';\n`,
  'utf8',
);
console.log('Wrote sle (re-exports sse)');
