import type { GameRules } from '../types';

const skyrimRulesBase: GameRules = {
  en: () => [
    '### STYLE, TONE, AND ATMOSPHERE (The Elder Scrolls V: Skyrim):',
    '- Setting: frozen province of Skyrim, 4E 201 — epic Nordic fantasy, civil war, dragon return. Speech ranges from archaic formal (Jarls, Greybeards) to rough mercenary banter.',
    '- Dialogue (grup: INFO/DIAL): speakable, often formal or period-appropriate; avoid modern colloquialisms.',
    '- UI/items (grup: FULL, DESC): terse RPG inventory style; weapon/armor names follow established fantasy conventions.',
    '- Books/notes (grup: BOOK): vary by author — scholarly, religious, bardic, criminal.',
    '',
    '### SKYRIM TERMINOLOGY (when no glossary):',
    "- Magic: Magicka, Stamina, Shout/Thu'um, Enchantment, Alchemy, Restoration, Destruction, etc.",
    '- Society: Jarl, Thane, Hold, Stormcloaks, Imperial Legion, Companions, Thieves Guild, Dark Brotherhood, College of Winterhold.',
    '- Creatures: Dragon, Draugr, Falmer, Mammoth, Sabre Cat, Spriggan, Dwemer automata.',
    '- Daedra and Aedra names: keep established transliterations or community canon.',
    '- Place names: Whiterun, Solitude, Windhelm, Riften, Markarth — transliterate consistently or translate if meaning is transparent and community does so.',
    '- Do not use Fallout post-apocalyptic vocabulary (caps, rads, vault).',
  ],
  uk: () => [
    '### СТИЛЬ, ТОН ТА АТМОСФЕРА (The Elder Scrolls V: Skyrim):',
    '- Сетинг: провінція Скайрім, 4Е 201 — епічне північне фентезі, громадянська війна, повернення драконів. Регістр від архаїчно-урочистого (ярли, Сіробороді) до грубуватого (найманці).',
    '- Діалоги (grup: INFO/DIAL): придатні для озвучення; уникай сучасного сленгу.',
    '- UI/предмети (grup: FULL, DESC): стислий RPG-стиль; назви зброї та обладунків узгоджені з фентезійною традицією.',
    '- Книги (grup: BOOK): тон залежить від автора — науковий, релігійний, бардовий.',
    '',
    '### КАНОНІЧНА ТЕРМІНОЛОГІЯ SKYRIM (за відсутності "glossary"):',
    "- Магія: Magicka → магіка; Stamina → витривалість; Shout → Крик (Сила Крику/Thu'um); Enchantment → зачарування; Alchemy → алхімія.",
    '- Суспільство: Jarl → ярл; Thane → тейн; Hold → володіння/холд; Stormcloaks → Бурові плащі; Imperial Legion → Імперський легіон.',
    '- Гільдії: Companions → Товариство; Thieves Guild → Гільдія злодіїв; Dark Brotherhood → Темне братство; College of Winterhold → Колегія Вінтерхолда.',
    '- Істоти: Dragon → дракон; Draugr → драугр; Falmer → фалмер; Sabre Cat → шаблезуб; Spriggan → спрігган.',
    '- Даедра: Azura, Mehrunes Dagon тощо — усталені форми або транслітерація.',
    '- Локації: Whiterun → Вайтран; Solitude → Солітьюд; Windhelm → Віндхельм; Riften → Ріфтен; Markarth → Маркарт.',
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
  ],
};

export const sseRules: GameRules = skyrimRulesBase;
