import { OB_UK_GLOSSARY } from '../../../../resources/glossary/ob-uk';
import { formatCanonicalEnLines, formatCanonicalUkLines } from '../canonical';
import type { GameRules } from '../types';

export const obRules: GameRules = {
  en: (targetLang) => [
    '### STYLE, TONE, AND ATMOSPHERE (The Elder Scrolls IV: Oblivion):',
    '- Setting: Cyrodiil during the Oblivion Crisis — high fantasy with slightly more theatrical, classical tone than Skyrim.',
    '- Dialogue: often formal, courtly, or melodramatic; guards and NPCs use polite or archaic phrasing.',
    '- UI/items: classic RPG labels; skills and attributes (Blade, Blunt, Destruction, Mysticism, etc.).',
    '',
    ...formatCanonicalEnLines('OBLIVION', OB_UK_GLOSSARY, targetLang),
    '- Magic schools differ from Skyrim (e.g. Mysticism, Blade/Blunt skills) — use Oblivion-era terms.',
    '',
    '### TRANSLATION EXAMPLES (Oblivion):',
    '- "Stop right there, criminal scum!" → theatrical guard tone in ' + targetLang + '.',
  ],
  uk: () => [
    '### СТИЛЬ, ТОН ТА АТМОСФЕРА (The Elder Scrolls IV: Oblivion):',
    '- Сетинг: Сиродил під час Кризи Забуття — класичне високе фентезі з театральнішим, придворним тоном.',
    '- Діалоги: часто формальні, урочисті; варти та горожани вживають ввічливі звороти.',
    '- UI/предмети: класичні RPG-назви; навички (Blade, Blunt, Destruction, Mysticism тощо).',
    '',
    ...formatCanonicalUkLines('OBLIVION', OB_UK_GLOSSARY),
    '- Школи магії Oblivion (Mysticism, Alteration…) — не плутай зі Skyrim-only термінами без контексту.',
    '',
    '### ПРИКЛАДИ (Oblivion):',
    '- "Stop right there, criminal scum!" → театральна мова варти Імперського міста.',
    '- "Summon Creature" (spell) → "Виклик істоти" (класичне фентезі, не сучасний сленг).',
  ],
  verifyUk: () => [
    '- Плутанина термінології Skyrim (напр. «Крик» замість заклинання) без контексту — "suspicious".',
    '- Транслітерація замість канонічного терміну зі списку вище — "suspicious" або "incorrect".',
  ],
};
