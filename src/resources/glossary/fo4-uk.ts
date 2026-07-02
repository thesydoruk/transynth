/**
 * Canonical Fallout 4 English → Ukrainian glossary.
 *
 * Curated from the confirmed (manually-saved) Ukrainian translations of the
 * base game (`Fallout4.esm`) stored in this project's database. Each pair was
 * picked as the most frequent / least ambiguous translation for that term
 * across NPC_/RACE/FACT/LCTN/ALCH/WEAP/ARMO records.
 *
 * This file is the single source of truth for the glossary; it is loaded by
 * `scripts/seedGlossary.ts` (run via `npm run db:seed:glossary`) which upserts
 * the rows into the `glossary` table. Keep it in sync with project conventions
 * rather than editing the database directly, so the glossary is never lost.
 *
 * Conventions observed in the localization (useful when adding new entries):
 *  - Firearms ("…Rifle"/"…Gun") are usually rendered as "…карабін".
 *  - "caps" → "кришки"; "Vault" → "Сховище"; "rads" → "радіація".
 *  - Brand / proper names are transliterated (Diamond City → Даймонд-сіті),
 *    while descriptive names are translated (Goodneighbor → Добросусідство).
 *
 * NOTE: highly ambiguous bare common words (e.g. the companion "Strong" vs the
 * adjective "strong", or the name "Father") are intentionally omitted to avoid
 * false positives in glossary QA enforcement, which matches the English term on
 * word boundaries.
 */

import type { GlossaryEntry } from './types';

export type { GlossaryEntry } from './types';

export const FO4_UK_GLOSSARY: GlossaryEntry[] = [
  // ── Factions & organizations ──────────────────────────────────────────────
  { term: 'Brotherhood of Steel', translation: 'Братерство сталі' },
  { term: 'Institute', translation: 'Інститут' },
  { term: 'Railroad', translation: 'Підземка' },
  { term: 'Minutemen', translation: 'Мінітмени' },
  { term: 'Gunners', translation: 'Стрільці' },
  { term: 'Raiders', translation: 'Рейдери' },
  { term: 'Raider', translation: 'Рейдер' },
  { term: 'Children of Atom', translation: 'Діти Атома' },
  { term: 'Atom Cats', translation: 'Атомні коти' },
  { term: 'The Forged', translation: 'Ковані' },
  { term: 'Covenant', translation: 'Альянс' },
  { term: 'Triggerman', translation: 'Гангстер' },
  { term: 'Triggermen', translation: 'Гангстери' },
  { term: 'The Pack', translation: 'Зграя' },
  { term: 'Vault-Tec', translation: 'Волт-Тек' },

  // ── Locations ─────────────────────────────────────────────────────────────
  { term: 'Commonwealth', translation: 'Співдружність' },
  { term: 'Diamond City', translation: 'Даймонд-сіті' },
  { term: 'Goodneighbor', translation: 'Добросусідство' },
  { term: 'Sanctuary Hills', translation: 'Сенкчуарі-Гіллз' },
  { term: 'Concord', translation: 'Конкорд' },
  { term: 'Lexington', translation: 'Лексінгтон' },
  { term: 'Bunker Hill', translation: 'Банкер-Гілл' },
  { term: 'Glowing Sea', translation: 'Сяюче море' },
  { term: 'Far Harbor', translation: 'Фар Гарбор' },
  { term: 'Nuka-World', translation: 'Ядер-Світ' },
  { term: 'The Memory Den', translation: 'Лігво спогадів' },
  { term: 'The Third Rail', translation: 'Третя рейка' },
  { term: 'The Combat Zone', translation: 'Бойова зона' },
  { term: 'Vault 111', translation: 'Сховище 111' },
  { term: 'Spectacle Island', translation: 'Спектакл-айленд' },
  { term: 'Red Rocket', translation: 'Червона ракета' },
  { term: 'Cambridge', translation: 'Кембридж' },
  { term: 'Prydwen', translation: 'Придвен' },
  { term: 'Mass Fusion', translation: "Масс ф'южн" },

  // ── Companions & named characters ───────────────────────────────────────────
  { term: 'Codsworth', translation: 'Кодсворт' },
  { term: 'Dogmeat', translation: 'Собака' },
  { term: 'Piper', translation: 'Пайпер' },
  { term: 'Preston Garvey', translation: 'Престон Гарві' },
  { term: 'Nick Valentine', translation: 'Нік Валентайн' },
  { term: 'Paladin Danse', translation: 'Паладин Данс' },
  { term: 'Danse', translation: 'Данс' },
  { term: 'Curie', translation: 'Кюрі' },
  { term: 'Cait', translation: 'Кейт' },
  { term: 'Deacon', translation: 'Дікон' },
  { term: 'Hancock', translation: 'Генкок' },
  { term: 'MacCready', translation: 'Маккріді' },
  { term: 'X6-88', translation: 'X6-88' },
  { term: 'Shaun', translation: 'Шон' },
  { term: 'Nora', translation: 'Нора' },
  { term: 'Nate', translation: 'Нейт' },
  { term: 'Kellogg', translation: 'Келлог' },
  { term: 'Virgil', translation: 'Верджіл' },
  { term: 'Desdemona', translation: 'Дездемона' },
  { term: 'Tinker Tom', translation: 'Технік Том' },
  { term: 'Elder Maxson', translation: 'Старійшина Мексон' },
  { term: 'Maxson', translation: 'Мексон' },
  { term: 'Sturges', translation: 'Стурджес' },
  { term: 'Mama Murphy', translation: 'Матінка Мерфі' },
  { term: 'Marcy Long', translation: 'Марсі Лон' },
  { term: 'Jun Long', translation: 'Цзюнь Лон' },
  { term: 'Magnolia', translation: 'Магнолія' },
  { term: 'Myrna', translation: 'Мирна' },
  { term: 'Pickman', translation: 'Пікман' },
  { term: 'Trashcan Carla', translation: 'Карла Урна' },

  // ── Creatures ───────────────────────────────────────────────────────────────
  { term: 'Deathclaw', translation: 'Кіготь смерті' },
  { term: 'Mirelurk', translation: 'Болотник' },
  { term: 'Mirelurk Queen', translation: 'Королева болотників' },
  { term: 'Mirelurk King', translation: 'Король болотників' },
  { term: 'Super Mutant', translation: 'Супермутант' },
  { term: 'Feral Ghoul', translation: 'Дикий гуль' },
  { term: 'Ghoul', translation: 'Гуль' },
  { term: 'Glowing One', translation: 'Сяючий' },
  { term: 'Radroach', translation: 'Радтарган' },
  { term: 'Bloatfly', translation: 'Дутень' },
  { term: 'Bloodbug', translation: 'Гнус' },
  { term: 'Stingwing', translation: 'Жалокрил' },
  { term: 'Mole Rat', translation: 'Кротощур' },
  { term: 'Molerat', translation: 'Кротощур' },
  { term: 'Yao Guai', translation: 'Яо-гай' },
  { term: 'Brahmin', translation: 'Брамін' },
  { term: 'Radstag', translation: 'Рад-олень' },
  { term: 'Radscorpion', translation: 'Радскорпіон' },
  { term: 'Mutant Hound', translation: 'Гончак-мутант' },
  { term: 'Behemoth', translation: 'Чудовисько' },
  { term: 'Synth', translation: 'Синт' },
  { term: 'Mongrel', translation: 'Собака' },
  { term: 'Gen 1 Synth', translation: 'Синт першого покоління' },
  { term: 'Gen 2 Synth', translation: 'Синт другого покоління' },
  { term: 'Wastelander', translation: 'Мешканець Пустки' },

  // ── Robots ──────────────────────────────────────────────────────────────────
  { term: 'Protectron', translation: 'Протектрон' },
  { term: 'Mr. Handy', translation: 'Містер Помічник' },
  { term: 'Mister Handy', translation: 'Містер Помічник' },
  { term: 'Mr. Gutsy', translation: 'Містер Сміливець' },
  { term: 'Sentry Bot', translation: 'Робот-охоронець' },
  { term: 'Assaultron', translation: 'Штурмотрон' },
  { term: 'Eyebot', translation: 'Робооко' },
  { term: 'EyeBot', translation: 'Робооко' },
  { term: 'Liberty Prime', translation: 'Ліберті Прайм' },
  { term: 'Turret', translation: 'Турель' },
  { term: 'Courser', translation: 'Мисливець' },

  // ── Chems & consumables ─────────────────────────────────────────────────────
  { term: 'Stimpak', translation: 'Стимулятор' },
  { term: 'Stimpack', translation: 'Стимулятор' },
  { term: 'RadAway', translation: 'Антирадин' },
  { term: 'Rad-X', translation: 'Рад-Х' },
  { term: 'Jet', translation: 'Гвинт' },
  { term: 'Psycho', translation: 'Психо' },
  { term: 'Mentats', translation: 'Ментати' },
  { term: 'Buffout', translation: 'Баффаут' },
  { term: 'Med-X', translation: 'Мед-Х' },
  { term: 'Addictol', translation: 'Аддиктол' },
  { term: 'Bufftats', translation: 'Бафф-тати' },
  { term: 'Berry Mentats', translation: 'Ягідні ментати' },
  { term: 'Nuka-Cola', translation: 'Ядер-Кола' },
  { term: 'Nuka-Cola Quantum', translation: 'Квантова Ядер-Кола' },
  { term: 'Purified Water', translation: 'Очищена вода' },
  { term: 'Dirty Water', translation: 'Брудна вода' },
  { term: 'Mutfruit', translation: 'Мутафрукт' },
  { term: 'Tarberry', translation: 'Смоляниця' },
  { term: 'Razorgrain', translation: 'Бритвозлак' },

  // ── Items, gear & core mechanics ────────────────────────────────────────────
  { term: 'Power Armor', translation: 'Силова броня' },
  { term: 'Fusion Core', translation: 'Ядерний блок' },
  { term: 'Fusion Cell', translation: 'Ядерна батарея' },
  { term: 'Pip-Boy', translation: 'Піп-бой' },
  { term: 'Vault', translation: 'Сховище' },
  { term: 'caps', translation: 'кришки' },
  { term: 'Caps', translation: 'Кришки' },
  { term: 'rads', translation: 'радіація' },
  { term: 'Holotape', translation: 'Голозапис' },
  { term: 'Settler', translation: 'Поселенець' },
  { term: 'Workshop', translation: 'Майстерня' },
  { term: 'Provisioner', translation: 'Постачальник' },
  { term: 'Stealth Boy', translation: 'Стелс-бой' },
  { term: 'Hazmat Suit', translation: 'Захисний комплект' },
  { term: 'Combat Armor', translation: 'Бойова броня' },
  { term: 'Metal Armor', translation: 'Металева броня' },
  { term: 'Frag Grenade', translation: 'Осколкова граната' },
  { term: 'Molotov Cocktail', translation: 'Коктейль Молотова' },

  // ── Weapons ─────────────────────────────────────────────────────────────────
  { term: 'Mini Nuke', translation: 'Ядерний мінізаряд' },
  { term: 'Nuke', translation: 'Ядерна бомба' },
  { term: 'Fat Man', translation: 'Товстун' },
  { term: 'Junk Jet', translation: 'Хламотрон' },
  { term: 'Cryolator', translation: 'Кріолятор' },
  { term: 'Gauss Rifle', translation: 'Карабін Гауса' },
  { term: 'Combat Rifle', translation: 'Бойовий карабін' },
  { term: 'Assault Rifle', translation: 'Штурмовий карабін' },
  { term: 'Hunting Rifle', translation: 'Мисливський карабін' },
  { term: 'Laser Musket', translation: 'Лазерний мушкет' },
  { term: 'Gamma Gun', translation: 'Гамма-пістолет' },
  { term: 'Minigun', translation: 'Мініган' },
  { term: 'Flamer', translation: 'Вогнемет' },
  { term: 'Gatling Laser', translation: 'Гатлінг-лазер' },
  { term: 'Plasma Gun', translation: 'Плазмовий карабін' },
  { term: 'Laser Gun', translation: 'Лазерний карабін' },
  { term: 'Missile Launcher', translation: 'Гранатомет' },
  { term: 'Deliverer', translation: 'Спаситель' },
  { term: 'Alien Blaster', translation: 'Бластер Чужих' },
  { term: 'Plasma Cartridge', translation: 'Заряд плазми' },

  // ── S.P.E.C.I.A.L. attributes ───────────────────────────────────────────────
  { term: 'Strength', translation: 'Сила' },
  { term: 'Perception', translation: 'Пильність' },
  { term: 'Endurance', translation: 'Витривалість' },
  { term: 'Charisma', translation: 'Харизма' },
  { term: 'Intelligence', translation: 'Інтелект' },
  { term: 'Agility', translation: 'Спритність' },
  { term: 'Luck', translation: 'Удача' },
];
