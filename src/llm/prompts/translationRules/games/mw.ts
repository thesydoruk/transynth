import { MW_UK_GLOSSARY } from '../../../../resources/glossary/mw-uk';
import { formatCanonicalEnLines, formatCanonicalUkLines } from '../canonical';
import type { GameRules } from '../types';

export const mwRules: GameRules = {
  en: (targetLang) => [
    '### STYLE, TONE, AND ATMOSPHERE (The Elder Scrolls III: Morrowind):',
    '- Setting: island of Vvardenfell, Dunmer culture — unique, slightly alien, formal and lore-heavy prose unlike later TES games.',
    '- Dialogue: often stiff, expository, or ceremonially polite; Great Houses and Temple have distinct diction.',
    '- UI/items: verbose item names possible; alchemical ingredients use fictional flora/fauna names.',
    '',
    ...formatCanonicalEnLines('MORROWIND', MW_UK_GLOSSARY, targetLang),
    "- Honorifics and titles: N'wah, ser, muthsera — translate intent or keep if established in target locale.",
    '- Distinct from Oblivion/Skyrim vocabulary — Morrowind has its own fauna, politics, and tone.',
    '',
    '### TRANSLATION EXAMPLES (Morrowind):',
    '- "Kwama egg mine" → use canonical creature name in ' + targetLang + '.',
  ],
  uk: () => [
    '### СТИЛЬ, ТОН ТА АТМОСФЕРА (The Elder Scrolls III: Morrowind):',
    '- Сетинг: Вварденфелл, культура данмерів — унікальний, трохи «чужий», формальний і насичений лором стиль.',
    '- Діалоги: часто уривчасті, експозиційні або церемоніально ввічливі; Великі Доми та Храм мають власний регістр.',
    '- UI/предмети: назви можуть бути довшими; інгредієнти алхімії — вигадана флора та фауна.',
    '',
    ...formatCanonicalUkLines('MORROWIND', MW_UK_GLOSSARY),
    "- Звертання (ser, muthsera, n'wah) — передавай смисл або залишай усталену форму.",
    '- Не підставляй лексику Skyrim/Oblivion без підстави в source.',
    '',
    '### ПРИКЛАДИ (Morrowind):',
    '- "Welcome, %s. I am %s." → збережи %s; звертання формальне, трохи уривчасте.',
    '- "Kwama egg mine" → "шахта яєць квама" (узгоджено з лором данмерів).',
  ],
  verifyUk: () => [
    '- Стиль має відповідати «морровіндській» формальності; надто сучасна розмовність у діалогах Храму — "suspicious".',
    '- Транслітерація замість канонічного терміну зі списку вище — "suspicious" або "incorrect".',
  ],
};
