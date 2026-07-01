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
    '- Power Armor part names: leftover English "Armor" or wrong part order — "incorrect".',
    '- Applying Power Armor "[side] [limb] [model]" to generic "Arm Armor" / set names (e.g. "Hellfire Mk.II Arm Armor") — "incorrect"; do not invent Right/Left absent from source.',
    '- Untranslated English set names in translation (e.g. "Hellfire Mk.II" left as-is) — "incorrect".',
    '- Institute/Synth terminology must stay consistent with established Fallout 4 canon.',
  ],
  verifyUk: () => [
    '- Частини силової броні (T-51 Right Arm Armor тощо): залишок "Armor" або зайве "броня" наприкінці — "incorrect"; формат "[сторона] [частина тіла] [модель]".',
    '- Застосування шаблону силової броні до інших предметів ("Hellfire Mk.II Arm Armor" → "Права рука Hellfire Mk.II") — "incorrect": не додавай "Права/Ліва", якщо їх немає в source; не залишай англійську назву сету.',
    '- Залишки англійської в перекладі (назви сетів, слова Arm/Armor) — "incorrect"; правильний приклад: "Hellfire Mk.II Arm Armor" → "Хелфайр броня для рук Mk.II".',
    '- Безпідставне відхилення від канонічної термінології Fallout 4 — "suspicious"; груба помилка в ключовій сутності — "incorrect".',
    '- Транслітерація замість канонічного терміну зі списку вище (напр. "Стелс Бой" замість "Стелс-бой") — "suspicious" або "incorrect".',
  ],
};
