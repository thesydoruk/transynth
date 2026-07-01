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

export const fo4Rules: GameRules = {
  en: (targetLang) => [
    '### STYLE, TONE, AND ATMOSPHERE (Fallout 4):',
    '- Setting: post-war Commonwealth (Boston area), 2287. Tone is pragmatic, weary, sometimes darkly humorous; survivors speak like people who have lived through loss.',
    '- Dialogue (grup: INFO/DIAL): natural spoken English suited for voice acting; contractions and interruptions are fine.',
    '- UI/items (grup: FULL, DESC, CNAM): concise inventory phrasing; item names should sound natural in a pip-boy list.',
    '- Books/notes (grup: BOOK): match the author — scientific logs, personal diaries, propaganda, pre-war ads.',
    ...falloutUiCategoriesEn,
    '',
    '### FALLOUT 4 TERMINOLOGY (when no glossary):',
    '- Economy/units: caps, rads, HP, AP, XP — keep or localize per community standard; do not convert numbers.',
    '- Core terms: Power Armor, Pip-Boy, Vault, Holotape, Fusion Core, Synth, Stimpak, RadAway, Rad-X.',
    '- Factions: Brotherhood of Steel, Institute, Railroad, Minutemen, Gunners, Raiders, Children of Atom.',
    '- Creatures: Deathclaw, Super Mutant, Feral Ghoul, Mirelurk, Synth, Radroach, Yao Guai, Brahmin.',
    '- Firearms: "...Rifle"/"...Gun" often map to carbine-style names in many locales; Pistol, Launcher as appropriate.',
    '- Power Armor parts (ARMO/FULL, e.g. "T-51 Right Arm Armor"): translate body part + keep model code; drop standalone "Armor" suffix per locale convention.',
    '- Locations: translate meaningful names (Goodneighbor, The Castle); transliterate established proper nouns consistently (Diamond City, Sanctuary).',
    '',
    '### TRANSLATION EXAMPLES (Fallout 4):',
    '- Dialogue: "Listen, Nick. We\'ve got a problem." → natural spoken ' +
      targetLang +
      ', preserve speaker tone.',
    '- UI: "Ammo - Ballistic" → both parts fully in ' +
      targetLang +
      '; "Wood" → natural capitalization, not ALL CAPS.',
    '- Masked: "I need ¤PH0¤ caps." → translate words, keep ¤PH0¤ unchanged.',
    '- ARMO/FULL: "T-51 Right Arm Armor" → body part + model per locale rules.',
  ],
  uk: () => [
    '### СТИЛЬ, ТОН ТА АТМОСФЕРА (Fallout 4):',
    '- Сетинг: постійна Співдружність (Бостон), 2287 р. Мова прагматична, зношена, подекуди з чорним гумором; без сучасного сленгу та канцеляриту.',
    '- Діалоги (grup: INFO/DIAL): жива розмовна мова для озвучення; інверсія, еліпсиси, вигуки.',
    '- UI/предмети (grup: FULL, DESC, CNAM): стисло; назви предметів звучать природно в інвентарі Піп-боя.',
    '- Книги/записи (grup: BOOK): тон автора — науковий, щоденниковий, пропаганда, довоєнна реклама.',
    ...falloutUiCategoriesUk,
    '',
    '### КАНОНІЧНА ТЕРМІНОЛОГІЯ FALLOUT 4 (за відсутності "glossary"):',
    '- Одиниці: caps → кришки; rads → радіація; stimpak → стимулятор; lbs, HP, AP, XP, % — не конвертуй числа.',
    '- Базові терміни: Power Armor → Силова броня; Fusion Core → Ядерний блок; Pip-Boy → Піп-бой; Vault → Сховище; Holotape → Голозапис; Synth → Синт; Settler → Поселенець; Workshop → Майстерня.',
    '- Зброя: "...Rifle"/"...Gun" → "...карабін" (Combat Rifle → Бойовий карабін, Plasma Gun → Плазмовий карабін); Pistol → пістолет; Launcher → гранатомет.',
    '- Частини силової броні (grup: ARMO/FULL, "T-51 Right Arm Armor"): формат "[частина тіла] [модель]" — слово "Armor" не залишай. Helmet → Шолом; Torso → Торс; Right/Left Arm → Права/Ліва рука; Right/Left Leg → Права/Ліва нога. Приклад: "T-51 Right Arm Armor" → "Права рука T-51".',
    '- Фракції: Brotherhood of Steel → Братерство сталі; Institute → Інститут; Railroad → Підземка; Minutemen → Мінітмени; Gunners → Стрільці; Raiders → Рейдери; Children of Atom → Діти Атома; Commonwealth → Співдружність.',
    '- Істоти: Deathclaw → Кіготь смерті; Super Mutant → Супермутант; Feral Ghoul → Дикий гуль; Mirelurk → Болотник; Radroach → Радтарган; Yao Guai → Яо-гай; Brahmin → Брамін.',
    '- Хімія/їжа: RadAway → Антирадин; Rad-X → Рад-Х; Jet → Гвинт; Psycho → Психо; Mentats → Ментати; Nuka-Cola → Ядер-Кола.',
    '- Локації: змістовні назви перекладай (Goodneighbor → Добросусідство, The Castle → Замок, Glowing Sea → Сяюче море); решту транслітеруй (Diamond City → Даймонд-сіті, Sanctuary Hills → Сенкчуарі-Гіллз).',
    '',
    '### ПРИКЛАДИ ПЕРЕКЛАДУ (Fallout 4):',
    '- Діалог: "Listen, Nick. We\'ve got a problem." → "Слухай, Ніку. У нас проблема." (жива розмовна мова, кличний відмінок).',
    '- UI: "Ammo - Ballistic" → "Боєприпаси — балістичні"; "Wood" → "Деревина" (не "ДЕРЕВ\'ЯНИЙ").',
    '- З масками: "I need ¤PH0¤ caps." → "Мені потрібно ¤PH0¤ кришок." (ключ ¤PH0¤ не чіпати).',
    '- ARMO/FULL: "Combat Armor" → "Бойова броня"; "T-51 Right Arm Armor" → "Права рука T-51".',
    '- BOOK: "The Commonwealth is a dangerous place." → "Співдружність — небезпечне місце." (тон оповіді).',
  ],
  verifyEn: () => [
    '- Power Armor part names: leftover English "Armor" or wrong part order — "incorrect".',
    '- Institute/Synth terminology must stay consistent with established Fallout 4 canon.',
  ],
  verifyUk: () => [
    '- Частини силової броні: залишок "Armor" або зайве "броня" наприкінці — "incorrect"; формат "[частина тіла] [модель]".',
    '- Безпідставне відхилення від канонічної термінології Fallout 4 — "suspicious"; груба помилка в ключовій сутності — "incorrect".',
  ],
};
