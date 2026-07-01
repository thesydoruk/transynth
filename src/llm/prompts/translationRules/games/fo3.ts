import type { GameRules } from '../types';

export const fo3Rules: GameRules = {
  en: () => [
    '### STYLE, TONE, AND ATMOSPHERE (Fallout 3):',
    '- Setting: Capital Wasteland (DC ruins), 2277. Bleaker, more desperate tone than New Vegas; survival and hope amid ruin.',
    '- Dialogue: direct, often grim; Project Purity and Brotherhood themes recur.',
    '- UI/items: concise wasteland survival phrasing.',
    '',
    '### FALLOUT 3 TERMINOLOGY (when no glossary):',
    '- Economy/units: caps, rads, HP, AP — standard Fallout.',
    "- Factions: Brotherhood of Steel (Lyons' chapter), Enclave, Raiders, Talon Company, Republic of Dave, Rivet City.",
    '- Locations: Megaton, Rivet City, Tenpenny Tower, Galaxy News Radio, Jefferson Memorial, Vault 101.',
    '- Creatures: Deathclaw, Super Mutant, Feral Ghoul, Mirelurk, Yao Guai — core Fallout creatures.',
    '- Super Mutants in FO3 originate from FEV — terminology consistent with Capital Wasteland lore.',
    '- No Institute, NCR, or Mojave-specific terms unless in source.',
  ],
  uk: () => [
    '### СТИЛЬ, ТОН ТА АТМОСФЕРА (Fallout 3):',
    '- Сетинг: Столична пустка (руїни Вашингтона), 2277. Більш похмурий і відчайдушний тон, ніж у New Vegas.',
    '- Діалоги: прямолінійні, подекуди жорсткі; теми Братства та «Проєкту Чистоти».',
    '- UI/предмети: стисла лексика виживання в пустці.',
    '',
    '### КАНОНІЧНА ТЕРМІНОЛОГІЯ FALLOUT 3 (за відсутності "glossary"):',
    '- caps → кришки; stimpak → стимулятор; Power Armor → Силова броня; Vault → Сховище; Pip-Boy → Піп-бой.',
    '- Фракції: Brotherhood of Steel → Братерство сталі (глава Лайонс); Enclave → Анклав; Talon Company → Компанія «Пазур»; Rivet City → Місто «Заклепка».',
    '- Локації: Megaton → Мегатон; Tenpenny Tower → Вежа Тенпенні; Galaxy News Radio → Галактичне радіо новин; Jefferson Memorial → Меморіал Джефферсона.',
    '- Істоти: Deathclaw → Кіготь смерті; Super Mutant → Супермутант; Feral Ghoul → Дикий гуль; Mirelurk → Болотник.',
    '- Не використовуй терміни Fallout 4 (Синт, Інститут) або New Vegas (НКР, Легіон), якщо їх немає в source.',
  ],
  verifyUk: () => [
    '- Терміни з інших частин серії Fallout без підстави в source — "suspicious" або "incorrect".',
  ],
};
