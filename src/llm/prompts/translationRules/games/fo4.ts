import { FO4_UK_GLOSSARY } from '../../../../resources/glossary/fo4-uk';
import { formatCanonicalEnLines, formatCanonicalUkLines } from '../canonical';
import type { GameRules } from '../types';

const falloutUiCategoriesEn = [
  '### UI CATEGORY LABELS (workshop, crafting, nested menus):',
  '- Translate every word, including category and subcategory labels. Do not leave English prefixes.',
  '- Pattern "[Category] - [Subcategory]" → fully translated in the target language for BOTH parts.',
  '- Typical categories: Ammo, Armor, Chems, Weapon, Science, Security, Water, Parts.',
];

const falloutUiCategoriesUk = [
  '### КАТЕГОРІЙНІ НАЗВИ UI (майстерня, крафт, вкладені меню):',
  '- Перекладай ВСІ слова, включно з категоріями та підкатегоріями.',
  '- Шаблон "[Category] - [Subcategory]" → "[Категорія] — [підкатегорія]", де ОБИДВІ частини українською.',
  '- "Ammo - Ballistic" → "Боєприпаси — балістичні"; "Armor - Standard" → "Броня — стандартна"; "Chems - Cures" → "Хімія — ліки".',
  '- Типові категорії: Ammo → боєприпаси; Armor → броня; Chems → хімія; Weapon → зброя; Science → наука; Security → безпека; Water → вода; Parts → деталі.',
];

const fo4NamingRulesEn = [
  '### FALLOUT 4 NAMING CONVENTIONS:',
  '- Economy/units: caps, rads, HP, AP, XP — keep or localize per community standard; do not convert numbers.',
  '- Firearms: "...Rifle"/"...Gun" often map to carbine-style names in many locales; Pistol, Launcher as appropriate.',
  '- Power Armor parts ONLY when the source names a PA model (T-45, T-51, T-60, X-01, Ultracite, etc.) AND usually includes Right/Left: translate body part + keep model code; drop standalone "Armor" suffix. Example: "T-51 Right Arm Armor" → locale format with explicit side + model.',
  '- Other armor pieces (set names, combat/leather/synth/mod items, e.g. "Hellfire Mk.II Arm Armor"): do NOT use the Power Armor "[side] [limb] [model]" template. Do NOT invent Right/Left when the source says only "Arm", "Leg", "Torso", or "Helmet". Pattern: transliterate the set/brand name + translate the slot ("Arm Armor" → arm-slot phrasing in target language) + keep version suffix (Mk.II). Example: "Hellfire Mk.II Arm Armor" → "Хелфайр броня для рук Mk.II" — NOT "Right arm Hellfire Mk.II".',
  '- Never leave English words in the translation except established model codes (T-51, Mk.II, X-01). Set names like "Hellfire" must be transliterated.',
  '- Locations: translate meaningful names (Goodneighbor, The Castle); transliterate established proper nouns consistently (Diamond City, Sanctuary).',
  '',
];

const fo4NamingRulesUk = [
  '### ПРАВИЛА ІМЕНУВАННЯ (Fallout 4):',
  '- Одиниці: lbs, HP, AP, XP, % — не конвертуй числа.',
  '- Зброя: "...Rifle"/"...Gun" → "...карабін" (Combat Rifle → Бойовий карабін, Plasma Gun → Плазмовий карабін); Pistol → пістолет; Launcher → гранатомет.',
  '- Частини СИЛОВОЇ броні (grup: ARMO/FULL) — ЛИШЕ коли в source є модель PA (T-45, T-51, T-60, X-01, Ultracite тощо) і зазвичай Right/Left: формат "[сторона, якщо є] [частина тіла] [модель]"; слово "Armor" не залишай. Helmet → Шолом; Torso → Торс; Right/Left Arm → Права/Ліва рука; Right/Left Leg → Права/Ліва нога. Приклад: "T-51 Right Arm Armor" → "Права рука T-51".',
  '- Інша броня (сети модів, бойова/шкіряна/синт, напр. "Hellfire Mk.II Arm Armor"): НЕ застосовуй шаблон силової броні. НЕ додавай "Права/Ліва", якщо в source лише "Arm", "Leg", "Torso" або "Helmet" без Right/Left. Шаблон: [назва сету транслітом] + [слот українською] + [версія]. Arm Armor → броня для рук; Leg Armor → броня для ніг; Torso/Chest Armor → броня для корпусу; Helmet → шолом. Приклад: "Hellfire Mk.II Arm Armor" → "Хелфайр броня для рук Mk.II".',
  '- Не залишай англійських слів у перекладі, крім усталених кодів моделей (T-51, Mk.II, X-01). Назви сетів (Hellfire, Combat тощо) транслітеруй.',
  '- Локації: змістовні назви перекладай (Goodneighbor → Добросусідство, The Castle → Замок, Glowing Sea → Сяюче море); решту транслітеруй (Diamond City → Даймонд-сіті, Sanctuary Hills → Сенкчуарі-Гіллз).',
  '',
];

export const fo4Rules: GameRules = {
  en: (targetLang) => [
    '### STYLE, TONE, AND ATMOSPHERE (Fallout 4):',
    '- Setting: post-war Commonwealth (Boston area), 2287. Tone is pragmatic, weary, sometimes darkly humorous; survivors speak like people who have lived through loss.',
    '- Dialogue (grup: INFO/DIAL): natural spoken English suited for voice acting; contractions and interruptions are fine.',
    '- UI/items (grup: FULL, DESC, CNAM): concise inventory phrasing; item names should sound natural in a pip-boy list.',
    '- Books/notes (grup: BOOK): match the author — scientific logs, personal diaries, propaganda, pre-war ads.',
    ...falloutUiCategoriesEn,
    '',
    ...fo4NamingRulesEn,
    ...formatCanonicalEnLines('FALLOUT 4', FO4_UK_GLOSSARY, targetLang),
    '### TRANSLATION EXAMPLES (Fallout 4):',
    '- Dialogue: "Listen, Nick. We\'ve got a problem." → natural spoken ' +
      targetLang +
      ', preserve speaker tone.',
    '- UI: "Ammo - Ballistic" → both parts fully in ' +
      targetLang +
      '; "Wood" → natural capitalization, not ALL CAPS.',
    '- Masked: "I need ¤PH0¤ caps." → translate words, keep ¤PH0¤ unchanged.',
    '- ARMO/FULL: "T-51 Right Arm Armor" → body part + model per locale rules; "Hellfire Mk.II Arm Armor" → transliterated set + arm-slot phrasing + Mk.II — never invent Right/Left.',
  ],
  uk: () => [
    '### СТИЛЬ, ТОН ТА АТМОСФЕРА (Fallout 4):',
    '- Сетинг: постійна Співдружність (Бостон), 2287 р. Мова прагматична, зношена, подекуди з чорним гумором; без сучасного сленгу та канцеляриту.',
    '- Діалоги (grup: INFO/DIAL): жива розмовна мова для озвучення; інверсія, еліпсиси, вигуки.',
    '- UI/предмети (grup: FULL, DESC, CNAM): стисло; назви предметів звучать природно в інвентарі Піп-боя.',
    '- Книги/записи (grup: BOOK): тон автора — науковий, щоденниковий, пропаганда, довоєнна реклама.',
    ...falloutUiCategoriesUk,
    '',
    ...fo4NamingRulesUk,
    ...formatCanonicalUkLines('FALLOUT 4', FO4_UK_GLOSSARY),
    '### ПРИКЛАДИ ПЕРЕКЛАДУ (Fallout 4):',
    '- Діалог: "Listen, Nick. We\'ve got a problem." → "Слухай, Ніку. У нас проблема." (жива розмовна мова, кличний відмінок).',
    '- UI: "Ammo - Ballistic" → "Боєприпаси — балістичні"; "Wood" → "Деревина" (не "ДЕРЕВ\'ЯНИЙ").',
    '- З масками: "I need ¤PH0¤ caps." → "Мені потрібно ¤PH0¤ кришок." (ключ ¤PH0¤ не чіпати).',
    '- ARMO/FULL: "Combat Armor" → "Бойова броня"; "T-51 Right Arm Armor" → "Права рука T-51"; "Hellfire Mk.II Arm Armor" → "Хелфайр броня для рук Mk.II" (без "Права/Ліва", якщо їх немає в source).',
    '- BOOK: "The Commonwealth is a dangerous place." → "Співдружність — небезпечне місце." (тон оповіді).',
  ],
  verifyEn: () => [
    '### VERIFY — item/mod names (priority over translate naming examples):',
    '- Word order or set-name position alone is NOT "incorrect" if meaning and slot (arm/leg/torso) are correct.',
    '- Power Armor parts (T-45/T-51 + Right/Left in source): leftover English "Armor" or wrong meaning — "incorrect".',
    '- Do NOT apply PA "[side] [limb] [model]" template to mod armor, robot miscmod parts, or Hellfire-style sets.',
    '- Robot model tokens in edid/source (Sentry, Assaultron, Protectron, Robobrain, MrHandy): transliterate; do NOT expand to creature names in item labels unless source says "Sentry Bot".',
    '- Do NOT add words absent from source (e.g. "Sentry Bot" in translation when source only says "Sentry").',
    '- Untranslated English in translation (except model codes T-51, Mk.II) — "incorrect".',
    '- Homonym/semantic errors (e.g. "Nose Bridge" → past tense verb instead of anatomical noun) — "incorrect".',
  ],
  verifyUk: () => [
    '### VERIFY — назви предметів/mod-модифікацій (пріоритет над прикладами translate):',
    '- Порядок слів або позиція назви сету (Warmonger на початку/в кінці) — НЕ "incorrect", якщо зміст і слот (рука/нога/торс) передані правильно.',
    '- Частини СИЛОВОЇ броні (T-51 Right Arm Armor): залишок "Armor", неправильний зміст — "incorrect".',
    '- НЕ застосовуй шаблон PA до mod-броні, miscmod-деталей роботів, сетів на кшталт Hellfire/Warmonger.',
    '- Токени моделей роботів у source/edid (Sentry, Assaultron, Protectron, Robobrain, MrHandy): транслітеруй; НЕ розширюй до "робот-охоронець" у назві предмета, якщо в source немає "Sentry Bot".',
    '- НЕ додавай слів, яких немає в source (напр. "робота-охоронця", якщо в source лише "Sentry").',
    '- НЕ змінюй уже коректну транслітерацію моделі на опис істоти та навпаки між audit-проходами.',
    '- Залишки англійської (крім кодів T-51, Mk.II) — "incorrect".',
    '- Омоніми/семантика (напр. "Nose Bridge" → дієслово "Перенісся" замість анатомічного іменника) — "incorrect".',
    '- Канонічна термінологія: дрібні відхилення — "suspicious"; груба помилка в ключовій сутності — "incorrect".',
  ],
};
