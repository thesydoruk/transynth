import type { GameRules } from '../types';

export const obRules: GameRules = {
  en: () => [
    '### STYLE, TONE, AND ATMOSPHERE (The Elder Scrolls IV: Oblivion):',
    '- Setting: Cyrodiil during the Oblivion Crisis — high fantasy with slightly more theatrical, classical tone than Skyrim.',
    '- Dialogue: often formal, courtly, or melodramatic; guards and NPCs use polite or archaic phrasing.',
    '- UI/items: classic RPG labels; skills and attributes (Blade, Blunt, Destruction, Mysticism, etc.).',
    '',
    '### OBLIVION TERMINOLOGY (when no glossary):',
    '- Factions: Imperial City, Septim dynasty, Blades, Mythic Dawn, Dark Brotherhood, Mages Guild, Fighters Guild, Thieves Guild, Knights of the Nine.',
    '- Planes: Oblivion, Deadlands, Shivering Isles — keep established names.',
    '- Creatures: Daedra, Dremora, Clannfear, Land Dreugh, Minotaur, Ogre, Will-o-the-Wisp.',
    '- Magic schools differ from Skyrim (e.g. Mysticism, Blade/Blunt skills) — use Oblivion-era terms.',
    '- Cities: Imperial City, Anvil, Bravil, Bruma, Cheydinhal, Chorrol, Kvatch, Leyawiin, Skingrad.',
  ],
  uk: () => [
    '### СТИЛЬ, ТОН ТА АТМОСФЕРА (The Elder Scrolls IV: Oblivion):',
    '- Сетинг: Сиродил під час Кризи Забуття — класичне високе фентезі з театральнішим, придворним тоном.',
    '- Діалоги: часто формальні, урочисті; варти та горожани вживають ввічливі звороти.',
    '- UI/предмети: класичні RPG-назви; навички (Blade, Blunt, Destruction, Mysticism тощо).',
    '',
    '### КАНОНІЧНА ТЕРМІНОЛОГІЯ OBLIVION (за відсутності "glossary"):',
    '- Фракції: Imperial City → Імперське місто; Blades → Клинки; Mythic Dawn → Міфічний світанок; Mages Guild → Гільдія магів; Fighters Guild → Гільдія воїнів.',
    '- Плани: Oblivion → Забуття; Shivering Isles → Тремтячі острови.',
    '- Істоти: Dremora → дрімора; Clannfear → кланфір; Minotaur → мінотавр; Ogre → огр.',
    '- Міста: Anvil → Ейнвіл; Bravil → Бравіл; Bruma → Брума; Cheydinhal → Чейдінхол; Kvatch → Кватч; Leyawiin → Леявін; Skingrad → Скінград.',
    '- Школи магії Oblivion (Mysticism, Alteration…) — не плутай зі Skyrim-only термінами без контексту.',
  ],
  verifyUk: () => [
    '- Плутанина термінології Skyrim (напр. «Крик» замість заклинання) без контексту — "suspicious".',
  ],
};
