import type { GameRules } from '../types';

export const mwRules: GameRules = {
  en: () => [
    '### STYLE, TONE, AND ATMOSPHERE (The Elder Scrolls III: Morrowind):',
    '- Setting: island of Vvardenfell, Dunmer culture — unique, slightly alien, formal and lore-heavy prose unlike later TES games.',
    '- Dialogue: often stiff, expository, or ceremonially polite; Great Houses and Temple have distinct diction.',
    '- UI/items: verbose item names possible; alchemical ingredients use fictional flora/fauna names.',
    '',
    '### MORROWIND TERMINOLOGY (when no glossary):',
    '- Culture: Dunmer, Ashlanders, Tribunal Temple, Great Houses (Hlaalu, Redoran, Telvanni, Dres, Indoril).',
    "- Places: Vvardenfell, Balmora, Vivec City, Ald'ruhn, Sadrith Mora, Molag Mar, Ghostgate.",
    '- Creatures: Kwama, Nix-hound, Netches, Cliff Racer, Dagoth Ur — preserve iconic creature names.',
    '- Systems: Marks/Drams currency; scrolls, enchantments, birthsigns.',
    "- Honorifics and titles: N'wah, ser, muthsera — translate intent or keep if established in target locale.",
    '- Distinct from Oblivion/Skyrim vocabulary — Morrowind has its own fauna, politics, and tone.',
  ],
  uk: () => [
    '### СТИЛЬ, ТОН ТА АТМОСФЕРА (The Elder Scrolls III: Morrowind):',
    '- Сетинг: Вварденфелл, культура данмерів — унікальний, трохи «чужий», формальний і насичений лором стиль.',
    '- Діалоги: часто уривчасті, експозиційні або церемоніально ввічливі; Великі Доми та Храм мають власний регістр.',
    '- UI/предмети: назви можуть бути довшими; інгредієнти алхімії — вигадана флора та фауна.',
    '',
    '### КАНОНІЧНА ТЕРМІНОЛОГІЯ MORROWIND (за відсутності "glossary"):',
    '- Культура: Dunmer → данмери; Ashlanders → попели; Tribunal Temple → Храм Трибуналу; Great Houses → Великі Доми (Hlaalu → Хлаалу, Redoran → Редоран, Telvanni → Телванні).',
    "- Місця: Vvardenfell → Вварденфелл; Balmora → Балмора; Vivec City → Вівек; Ald'ruhn → Альд'рун; Sadrith Mora → Садріт Мора.",
    '- Істоти: Kwama → квама; Netch → нетч; Cliff Racer → скельний гончик; Dagoth Ur → Дагот Ур.',
    '- Валюта: drakes → дрейки; marks → марки (за контекстом).',
    "- Звертання (ser, muthsera, n'wah) — передавай смисл або залишай усталену форму.",
    '- Не підставляй лексику Skyrim/Oblivion без підстави в source.',
  ],
  verifyUk: () => [
    '- Стиль має відповідати «морровіндській» формальності; надто сучасна розмовність у діалогах Храму — "suspicious".',
  ],
};
