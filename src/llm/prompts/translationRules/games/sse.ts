import { SSE_UK_GLOSSARY } from '../../../../resources/glossary/sse-uk';
import { formatCanonicalEnLines, formatCanonicalUkLines } from '../canonical';
import type { GameRules } from '../types';

const skyrimRulesBase: GameRules = {
  en: (targetLang) => [
    '### STYLE, TONE, AND ATMOSPHERE (The Elder Scrolls V: Skyrim):',
    '- Setting: frozen province of Skyrim, 4E 201 — epic Nordic fantasy, civil war, dragon return. Speech ranges from archaic formal (Jarls, Greybeards) to rough mercenary banter.',
    '- Dialogue (grup: INFO/DIAL): speakable, often formal or period-appropriate; avoid modern colloquialisms.',
    '- UI/items (grup: FULL, DESC): terse RPG inventory style; weapon/armor names follow established fantasy conventions.',
    '- Books/notes (grup: BOOK): vary by author — scholarly, religious, bardic, criminal.',
    '',
    ...formatCanonicalEnLines('SKYRIM', SSE_UK_GLOSSARY, targetLang),
    '- Daedra and Aedra names: keep established transliterations or community canon.',
    '- Do not use Fallout post-apocalyptic vocabulary (caps, rads, vault).',
    '',
    '### TRANSLATION EXAMPLES (Skyrim):',
    '- "I used to be an adventurer like you…" → natural spoken ' + targetLang + '.',
  ],
  uk: () => [
    '### СТИЛЬ, ТОН ТА АТМОСФЕРА (The Elder Scrolls V: Skyrim):',
    '- Сетинг: провінція Скайрім, 4Е 201 — епічне північне фентезі, громадянська війна, повернення драконів. Регістр від архаїчно-урочистого (ярли, Сіробороді) до грубуватого (найманці).',
    '- Діалоги (grup: INFO/DIAL): придатні для озвучення; уникай сучасного сленгу.',
    '- UI/предмети (grup: FULL, DESC): стислий RPG-стиль; назви зброї та обладунків узгоджені з фентезійною традицією.',
    '- Книги (grup: BOOK): тон залежить від автора — науковий, релігійний, бардовий.',
    '',
    ...formatCanonicalUkLines('SKYRIM', SSE_UK_GLOSSARY),
    '- Даедра: Azura, Mehrunes Dagon тощо — усталені форми або транслітерація.',
    '- Жодної постапокаліптичної лексики Fallout (кришки, радіація, сховище).',
    '',
    '### ПРИКЛАДИ (Skyrim):',
    '- "I used to be an adventurer like you…" → жива розмовна мова, природний ритм для озвучення.',
    '- "Iron Sword" (WEAP/FULL) → "Залізний меч"; "Favor the bow" → звертання ярла, урочистий тон.',
    '- "Fus Ro Dah" → не перекладай Крик; власні назви заклинань лишай.',
  ],
  verifyUk: () => [
    '- Лексика Fallout у фентезійному контексті — "incorrect".',
    '- Звертання ярлів і священиків має бути урочистим; грубе «ти» до ярла без контексту — "suspicious".',
    '- Транслітерація замість канонічного терміну зі списку вище — "suspicious" або "incorrect".',
  ],
};

export const sseRules: GameRules = skyrimRulesBase;
