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

const fo4DescriptiveDashEn = [
  '### DASH IN NAMES (NOT workshop category menus):',
  '- "[Adjective] - [Noun]" or "[Title] - [Subtitle]" → translate both parts; use colon or em dash per locale. NOT the workshop "Category — Subcategory" inventory pattern.',
  '- Examples: "Generator - Large" → large generator phrasing; "Bottle Message - Need a Hand" → bottle letter + subtitle; "VR Spawner - Alien" → VR spawner + creature type.',
];

const fo4DescriptiveDashUk = [
  '### ДЕФІС У НАЗВАХ (НЕ категорії майстерні):',
  '- "[Прикметник/назва] - [підзаголовок]" → переклад обох частин; двокрапка або тире за стилем локалі. Це НЕ шаблон інвентарних категорій "Категорія — підкатегорія".',
  '- "Generator - Large" → "Великий генератор"; "Bottle Message - Need a Hand" → "Лист у пляшці: потрібна допомога"; "VR Spawner - Alien" → "VR-генератор: інопланетянин".',
];

const fo4LegendaryAffixesEn = [
  '### LEGENDARY AFFIXES (WEAP/ARMO name prefixes):',
  '- Compact modifier names from glossary — NOT expanded effect descriptions.',
  '- Pattern: [affix] + [weapon/armor name]; one adjective stem, not "against …" phrasing.',
  '- "Assassin\'s" → human-damage affix per glossary; not a full phrase like "assassin of humans".',
  '- "Exterminator\'s" → bug/robot damage affix; not unrelated words like "insecticide".',
  '- "Stalker\'s" → sneak-damage affix; not accuracy/sniper wording.',
  '- "Lucky" → luck affix per glossary; do not transliterate as a proper name.',
  '- "Never Ending" → short magazine-affix name; not a full sentence about reloading.',
  '- "Incendiary" → fire damage; "Explosive" → explosive damage — not unrelated ammo types.',
  '- Match adjective gender to the head noun (rifle, armor, gauntlets).',
];

const fo4LegendaryAffixesUk = [
  '### ЛЕГЕНДАРНІ АФІКСИ (WEAP/ARMO, префікс у назві):',
  '- Стисла назва модифікатора з glossary — НЕ розгорнутий опис ефекту в Pip-Boy.',
  '- Шаблон: [афікс] + [зброя/броня]; один прикметниковий корінь, без «проти …» у префіксі.',
  "- «Assassin's» → «Вбивчий …»; НЕ «Вбивці людей» чи «Вбивча» з іншим коренем.",
  "- «Exterminator's» → «Винищувальний …»; НЕ «Інсектицидний» (калька з insects).",
  "- «Stalker's» → «Розвідувальний …»; НЕ «Точний» (accuracy). «Sentinel's» → «Статичний …» (стоячи на місці).",
  "- «Ghoul Slayer's» / «Mutant Slayer's» → «Гулевинищувальний» / «Мутантовинищувальний»; НЕ «Вбивці гулів».",
  '- «Lucky» → «Фартовий»; НЕ «Лаккі». «VATS Enhanced» → «VATS оптимізований»; НЕ «З VATS».',
  '- «Never Ending» → «Необмежений» / «Невичерпний»; НЕ речення про магазин.',
  '- «Incendiary» → «Запальний»; НЕ «Бронебійний». «Explosive» → «Вибуховий»; НЕ «Вибухівка» (іменник).',
  '- Узгоджуй рід/відмінок прикметника з іменником (карабін, броня, рукавиця).',
];

const fo4ArmorModNamesEn = [
  '### ARMOR MOD SLOT NAMES (OMOD):',
  '- Use compact canonical slot labels from glossary — noun phrases, not "Equipped with …" descriptions.',
  '- "Deep Pocketed" → pocket upgrade name; not "With deep pockets".',
  '- "Lead Lined" → lead lining slot; "Dense" → explosion-protection slot; "Ultra-Light Build" → ultralight build.',
  '- "BioCommMesh" → mesh upgrade name; "Tesla Bracers" → bracer name, not a full sentence.',
  '- "Jet Pack" on armor → reactive prefix; standalone item → jet pack name per glossary.',
];

const fo4ArmorModNamesUk = [
  '### МОДИФІКАТОРИ БРОНІ (OMOD, назва слота):',
  '- Стисла канонічна формула з glossary — іменник/назва слота, НЕ опис «Обладнана …» / «З …».',
  '- «Deep Pocketed» → «Глибокі кишені»; НЕ «З глибокими кишенями». «Pocketed» → «Додаткові кишені».',
  '- «Lead Lined» → «Свинцева обшивка»; «Dense» → «Вибухозахист»; «Ultra-Light Build» → «Надлегкість».',
  '- «BioCommMesh» → «Біомережа»; «Tesla Bracers» → «Наручі Тесли».',
  '- «Jet Pack» у назві броні → «Реактивна …»; окремий предмет → «Реактивний ранець».',
];

const fo4FactionAdjectiveEn = [
  '### FACTION NOUN vs ADJECTIVE IN ITEM NAMES:',
  '- "Institute" (faction) → proper noun; in item names use adjective form (Institute laser rifle).',
  '- "Railroad" (faction) → faction name; adjective form for gear — not quoted faction name inside item label.',
  '- "Minuteman" / "Gunner" → member or adjective forms for gear; singular Gunner ≠ plural Gunners faction.',
  '- "The Institute" / "The Brotherhood" / "The Railroad" / "The Commonwealth" → full names per glossary.',
];

const fo4FactionAdjectiveUk = [
  '### ФРАКЦІЇ: ІМЕННИК vs ПРИКМЕТНИК У НАЗВАХ ПРЕДМЕТІВ:',
  '- «Institute» (фракція) → «Інститут»; у назві зброї/броні — «інститутський/інститутська» («Інститутська лазерна гвинтівка»).',
  '- «Railroad» (фракція) → «Підземка»; прикметник — «підземна/підземний» («Підземна гвинтівка»), НЕ лапки «"Підземка"» всередині назви.',
  '- «Minuteman» → «Мінітмен»; прикметник — «мінітменський/мінітменська».',
  '- «Gunner» (одн., людина) → «стрілець»; прикметник — «стрілецька/стрілецький»; «Gunners» (мн.) → «Стрільці».',
  '- «The Institute» / «The Brotherhood» / «The Railroad» / «The Commonwealth» — повні назви з «The» → див. glossary.',
  '- «Glory to Atom!» → «Слава Атому!»; «Atom watch over you» → «Атом захистить вас.»',
];

const fo4NamingRulesEn = [
  '### FALLOUT 4 NAMING CONVENTIONS:',
  '- Economy/units: caps, rads, HP, AP, XP — keep or localize per community standard; do not convert numbers.',
  '- Firearms: "...Rifle"/"...Gun" often map to carbine-style names in many locales; Pistol, Launcher as appropriate.',
  '- Power Armor parts (ARMO/FULL with Right/Left): "[side] [limb] [model]" OR "[model] armor for [side] [limb]" — both OK. Drop standalone English "Armor". Example: "T-51 Right Arm Armor" → "Right arm T-51" or "T-51 armor for right arm".',
  '- Power Armor upgrade parts (MISC, no Right/Left in source): "[model] [slot]" — e.g. "T-45d Arm Armor" → "T-45d arm armor" phrasing without inventing a side; "T-45d Helmet" → "T-45d Helmet"; "Torso Lining" → "Torso lining".',
  '- Other armor pieces (set names, combat/leather/synth/mod items, e.g. "Hellfire Mk.II Arm Armor"): do NOT use the Power Armor "[side] [limb] [model]" template. Do NOT invent Right/Left when the source says only "Arm", "Leg", "Torso", or "Helmet". Pattern: transliterate the set/brand name + translate the slot ("Arm Armor" → arm-slot phrasing in target language) + keep version suffix (Mk.II). Example: "Hellfire Mk.II Arm Armor" → "Хелфайр броня для рук Mk.II" — NOT "Right arm Hellfire Mk.II".',
  '- Never leave English words in the translation except established model codes (T-51, Mk.II, X-01). Set names like "Hellfire" must be transliterated.',
  '- Locations: translate meaningful names (Goodneighbor, The Castle); transliterate established proper nouns consistently (Diamond City, Sanctuary).',
  '',
];

const fo4NamingRulesUk = [
  '### ПРАВИЛА ІМЕНУВАННЯ (Fallout 4):',
  '- Одиниці: lbs, HP, AP, XP, % — не конвертуй числа; «шкода» для damage (не «урон»).',
  '- Зброя: "...Rifle"/"...Gun" → "...карабін" (Combat Rifle → Бойовий карабін, Plasma Gun → Плазмовий карабін); Pistol → пістолет; Launcher → гранатомет.',
  '- Частини СИЛОВОЇ броні (ARMO/FULL, Right/Left у source): обидва формати OK — "[Права/Ліва] [рука/нога] [модель]" АБО "Броня [модель] для [правої/лівої] [руки/ноги]". Слово "Armor" не залишай. Приклади: "T-51 Right Arm Armor" → "Права рука T-51" або "Броня T-51 для правої руки".',
  '- Деталі PA для крафту (MISC, без Right/Left): "T-45d Arm Armor" → "Броня T-45d для руки"; "T-45d Helmet" → "Шолом T-45d"; "T-45d Torso Lining" → "Обшивка T-45d" — НЕ додавай "Права/Ліва", якщо їх немає в source.',
  '- Компактні AVIF/STAT для PA: "Power Armor Vent" → "Силова броня: отвір"; шаблон "Силова броня: [стат]".',
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
    ...fo4DescriptiveDashEn,
    '',
    ...fo4LegendaryAffixesEn,
    '',
    ...fo4ArmorModNamesEn,
    '',
    ...fo4FactionAdjectiveEn,
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
    '- Legendary: "Assassin\'s Combat Rifle" → compact affix + weapon per glossary; not a full phrase.',
    '- OMOD: "Deep Pocketed" → slot name per glossary; not "With deep pockets".',
    '- Masked: "I need ¤PH0¤ caps." → translate words, keep ¤PH0¤ unchanged.',
    '- ARMO/FULL: "T-51 Right Arm Armor" → body part + model per locale rules; "Hellfire Mk.II Arm Armor" → transliterated set + arm-slot phrasing + Mk.II — never invent Right/Left.',
    '- MISC PA: "T-45d Arm Armor" → model + slot without side; "T-45d Helmet" → "T-45d Helmet" localized.',
    '- INFO: "Paladin. Congratulations." → vocative + natural line; "You\'ve walked into a hornet\'s nest." → idiomatic target language, not literal.',
  ],
  uk: () => [
    '### СТИЛЬ, ТОН ТА АТМОСФЕРА (Fallout 4):',
    '- Сетинг: постійна Співдружність (Бостон), 2287 р. Мова прагматична, зношена, подекуди з чорним гумором; без сучасного сленгу та канцеляриту.',
    '- Канон BDD / Fallout 4 UA: «шкода» (не «урон»), «кришки», «Сховище», «Піп-бой»; назви предметів у Pip-Boy — стисло, без розгорнутих описів ефектів.',
    '- Легендарні афікси та OMOD-слоти: стисла формула з glossary — не розширюй описом ефекту й не підбирай синонім (див. секції нижче).',
    '- Діалоги (grup: INFO/DIAL): жива розмовна мова для озвучення; інверсія, еліпсиси, вигуки.',
    '- UI/предмети (grup: FULL, DESC, CNAM): стисло; назви предметів звучать природно в інвентарі Піп-боя.',
    '- Книги/записи (grup: BOOK): тон автора — науковий, щоденниковий, пропаганда, довоєнна реклама.',
    ...falloutUiCategoriesUk,
    '',
    ...fo4DescriptiveDashUk,
    '',
    ...fo4LegendaryAffixesUk,
    '',
    ...fo4ArmorModNamesUk,
    '',
    ...fo4FactionAdjectiveUk,
    '',
    ...fo4NamingRulesUk,
    ...formatCanonicalUkLines('FALLOUT 4', FO4_UK_GLOSSARY),
    '### ПРИКЛАДИ ПЕРЕКЛАДУ (Fallout 4):',
    '- Діалог: "Listen, Nick. We\'ve got a problem." → "Слухай, Ніку. У нас проблема." (жива розмовна мова, кличний відмінок).',
    '- UI: "Ammo - Ballistic" → "Боєприпаси — балістичні"; "Wood" → "Деревина" (не "ДЕРЕВ\'ЯНИЙ").',
    '- Легендарний афікс: "Assassin\'s Combat Rifle" → "Вбивчий бойовий карабін"; "Lucky Laser Gun" → "Фартовий лазерний карабін".',
    '- OMOD: "Deep Pocketed" → "Глибокі кишені"; "Lead Lined" → "Свинцева обшивка".',
    '- Фракційна броня: "Institute Lab Coat" → "Інститутський лабораторний халат"; "Railroad Gauntlets" → "Підземні рукавиці".',
    '- З масками: "I need ¤PH0¤ caps." → "Мені потрібно ¤PH0¤ кришок." (ключ ¤PH0¤ не чіпати).',
    '- ARMO/FULL: "Combat Armor" → "Бойова броня"; "T-51 Right Arm Armor" → "Права рука T-51" або "Броня T-51 для правої руки"; "Hellfire Mk.II Arm Armor" → "Хелфайр броня для рук Mk.II" (без "Права/Ліва", якщо їх немає в source).',
    '- MISC PA: "T-45d Arm Armor" → "Броня T-45d для руки"; "T-45d Helmet" → "Шолом T-45d"; "T-45d Torso Lining" → "Обшивка T-45d".',
    '- DIAL: "Barter" → "Торгувати"; "Not Interested" → "Мені це не цікаво"; "Sarcastic" → "Сарказм" (фіксовані варіанти меню).',
    '- INFO: "Paladin. Congratulations." → "Паладин. Вітаю."; "You\'ve walked into a hornet\'s nest." → "Ласкаво просимо до осиного гнізда." (ідіома, не дослівно).',
    '- BOOK: "The Commonwealth is a dangerous place." → "Співдружність — небезпечне місце." (тон оповіді).',
  ],
  verifyEn: () => [
    '### VERIFY — item/mod names (priority over translate naming examples):',
    '- Word order or set-name position alone is NOT "incorrect" if meaning and slot (arm/leg/torso) are correct.',
    '- Power Armor parts (T-45/T-51 + Right/Left in source): leftover English "Armor" or wrong meaning — "incorrect". Both "[side] [limb] [model]" and "[model] armor for [side] [limb]" are OK.',
    '- MISC PA upgrade parts without Right/Left: "T-45d Arm Armor" → slot phrasing without inventing a side — OK; do not require PA equipped-part word order.',
    '- DIAL/MESG menu labels (Barter, Not Interested, Sarcastic, Dismiss): fixed short UI strings — do not rephrase synonyms.',
    '- MGEF/chem perk lines: "[Chem]: [effect]" pattern OK (e.g. Jet + AP → "Гвинт: … очок дії").',
    '- TERM BTXT: short source with unrelated long translation (different topic, EDID collision) — "incorrect"; terminal headers like "=== Institute Central Network ===" OK when matching sibling rows.',
    '- Do NOT apply PA "[side] [limb] [model]" template to mod armor, robot miscmod parts, or Hellfire-style sets.',
    '- Robot model tokens in edid/source (Sentry, Assaultron, Protectron, Robobrain, MrHandy): transliterate; use genitive for limb slots (e.g. "Assaultron Left Arm" → "Ліва рука штурмотрона"). Do NOT leave English model names.',
    '- Do NOT expand model tokens to creature names in compact item labels (no "робот-охоронець" when source only says "Sentry Bot" in a short mod name — transliterate "сентрі" instead).',
    '- Factory (armor set) → "фабрична" or transliterate consistently; never leave bare English "Factory".',
    '- Face morph "Nose Bridge" (RACE/FMRN) → anatomical "Переносиця", NOT the verb/homograph "Перенісся".',
    '- RACE/FMRN morph labels: "Bot"/"Bottom" = lower part (нижня/низ), NOT "robot/robotized". "Main" = primary part; compact labels OK.',
    '- Eyelid morphs: "повіка" is correct Ukrainian; do NOT flag "Нижня повіка" as Russism.',
    '- Compact vs verbose morph names (e.g. "Низ вуха" vs "Нижня частина вуха") — both OK if meaning matches; do not flip between them.',
    '- Weapon/mod stat lines (OMOD/WEAP DESC): keep "шкода" for damage; do NOT replace with "урон" or "ушкодження" in verify.',
    '- Singular "Gunner" (one person) → "стрілець", NOT faction "Стрільці". Plural "Gunners" → "Стрільці".',
    '- Legendary affixes: compact glossary form required — "Stalker\'s" not "Точний"; "Exterminator\'s" not "Інсектицидний"; "Lucky" not "Лаккі"; "Incendiary" not "Бронебійний".',
    '- OMOD armor slots: "Deep Pocketed" → "Глибокі кишені" not "З глибокими кишенями"; "Tesla Bracers" → "Наручі Тесли" not a full sentence.',
    '- Faction gear: "Railroad" adjective → "Підземна/Підземний", not quoted «"Підземка"» inside item name; "Institute" adjective → "Інститутська/Інститутський".',
    '- "Remnant" in object names → leftover/trace (залишок сигналу), NOT "залишки [faction]".',
    '- Mod name tokens (Beaton, JuryRigged): transliterate as proper names; do NOT read Beaton as "concrete/beton".',
    '- Do not infer display words from edid (Perk, PickUp); judge by source field only.',
    '- "Barrel" → "ствол" (NOT "стівол", NOT "стіл"/table).',
    '- Inflected glossary terms are OK: Deathclaw → "Кіготь смерті", genitive "Кіготя смерті"; Ada vocative → "Адо".',
    '- Garbled/corrupt source terminal tags: judge by meaning; match the style of sibling BTXT rows (localized status line inside `<...>` is OK).',
    '- Untranslated English in translation (except model codes T-51, Mk.II) — "incorrect".',
    '- If you cannot propose a different suggestion, verdict MUST be "ok" (not "incorrect").',
  ],
  verifyUk: () => [
    '### VERIFY — назви предметів/mod-модифікацій (пріоритет над прикладами translate):',
    '- Порядок слів або позиція назви сету (Warmonger на початку/в кінці) — НЕ "incorrect", якщо зміст і слот (рука/нога/торс) передані правильно.',
    '- Частини СИЛОВОЇ броні (T-51 Right Arm Armor): залишок "Armor", неправильний зміст — "incorrect". OK: "Права рука T-51" та "Броня T-51 для правої руки".',
    '- MISC PA (T-45d Arm Armor): "Броня T-45d для руки" без "Права/Ліва" — OK.',
    '- DIAL/MESG (Barter, Not Interested, Sarcastic, Dismiss): фіксовані короткі варіанти меню — не пропонуй синоніми.',
    '- MGEF/хімія: шаблон «[Хімія]: [ефект]» OK (напр. «Гвинт: зміцнення очок дії»).',
    '- TERM BTXT: короткий source і переклад на іншу тему/набагато довший (EDID-колізія TM) — "incorrect"; заголовки терміналів «=== Центральна мережа Інституту ===» OK за стилем сусідніх рядків.',
    '- НЕ застосовуй шаблон PA до mod-броні, miscmod-деталей роботів, сетів на кшталт Hellfire/Warmonger.',
    '- Моделі роботів (Sentry, Assaultron, Protectron, MrHandy): транслітеруй; у назвах частин — родовий відмінок моделі ("Ліва рука штурмотрона", "броня для правої ноги протектрона"). Не залишай англійську.',
    '- НЕ розширюй модель до опису істоти в коротких назвах (не "робот-охоронець", якщо в source компактна назва з "Sentry" — "сентрі").',
    '- Factory (сет броні) → "фабрична" або стабільна транслітерація; не залишай "Factory" англійською.',
    '- "Nose Bridge" (RACE/FMRN, частина обличчя) → "Переносиця", НЕ "Перенісся" (омонім дієслова).',
    '- RACE/FMRN (редактор обличчя): "Bot"/"Bottom" = нижня частина/низ, НЕ «робот/роботизований». "Main" = основна частина; стислі назви («Низ вуха», «Середина вуха») допустимі.',
    '- Повіка: «повіка» — нормативна українська; «Нижня повіка» / «Верхня повіка» — НЕ русизм, verdict "ok".',
    '- Стислий vs розлогий варіант назви частини тіла («Низ вуха» ↔ «Нижня частина вуха») — обидва OK за однакового змісту; не міняй туди-назад.',
    '- Характеристики зброї/модів (OMOD, WEAP DESC): «шкода» для damage — проектна норма; НЕ замінюй на «урон»/«ушкодження» під час verify. «Більша/менша/покращена шкода» — OK.',
    '- «Gunner» (одн., людина) → «стрілець»/«стрільця»; «Gunners» (фракція) → «Стрільці». Не плутай у цілях квестів («Піп-бой стрільця» ≠ «Піп-бой Стрільців»).',
    "- Легендарні афікси: стисла форма з glossary — «Stalker's» ≠ «Точний»; «Exterminator's» ≠ «Інсектицидний»; «Lucky» ≠ «Лаккі»; «Incendiary» ≠ «Бронебійний»; «Never Ending» ≠ речення про магазин.",
    '- OMOD-броня: «Deep Pocketed» → «Глибокі кишені», НЕ «З глибокими кишенями»; «Tesla Bracers» → «Наручі Тесли», НЕ «Обладнана наручами…».',
    '- Фракційна броня/зброя: «Railroad» як прикметник → «Підземна/Підземний», НЕ лапки «"Підземка"»; «Institute» → «Інститутська/Інститутський».',
    "- «Remnant» у назвах об'єктів → залишок/слід (напр. «залишок сигналу»), НЕ «залишки стрільців».",
    "- Власні назви в mod-назвах (Beaton, JuryRigged): транслітеруй; Beaton — ім'я/термін, НЕ «бетон».",
    '- "Barrel" → «ствол» (НЕ «стівол», НЕ «стіл»).',
    '- Не виводь слова з edid (Perk, PickUp) у suggestion, якщо їх немає в source.',
    '- Відмінювання канону OK: Deathclaw → "Кіготь смерті", род. "Кіготя смерті"; кличний Ada → "Адо".',
    '- Пошкоджений source у TERM BTXT: оцінюй зміст; локалізований рядок статусу в `<...>` допустимий (як у сусідніх рядках).',
    '- EyeBot/Eyebot → "Робооко" (глосарій).',
    '- Залишки англійської (крім кодів T-51, Mk.II) — "incorrect".',
    '- Якщо не можеш запропонувати інший suggestion — verdict "ok", не "incorrect".',
    '- Канонічна термінологія: дрібні відхилення — "suspicious"; груба помилка в ключовій сутності — "incorrect".',
  ],
};
