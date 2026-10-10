import { WITCHER3_UK_GLOSSARY } from './glossary';
import {
  formatCanonicalEnLines,
  formatCanonicalUkLines,
} from '../../../llm/prompts/translationRules/canonical';
import type { GameRules } from '../../../llm/prompts/translationRules/types';

const witcherPlaceholdersEn = [
  '### PLACEHOLDER AND TAG PRESERVATION (The Witcher 3 / .w3strings):',
  '- Game markup arrives as parts + integer slots: HTML-like tags (<br>, <font color="…">…</font>, <img src="…">), {0}, %s and line breaks.',
  '- Never write a raw tag or ¤PH0¤ inside a string part. A paired <font> tag is two indices around the words it colours.',
  '- Reorder slots only when target-language grammar requires it. Keep numbers, percentages and key names unchanged.',
];

const witcherStyleEn = [
  '### STYLE, TONE, AND ATMOSPHERE (The Witcher 3):',
  "- Dark Slavic fantasy from Sapkowski's saga: war-torn Northern Kingdoms, Velen, Novigrad, Skellige, Toussaint. Not a Bethesda RPG.",
  "- Dialogue lines (grup W3D) carry speaker, speaker_gender, addressee and addressee_gender from the game's own scene files — authoritative: inflect for the speaker's and the listener's gender as given. Geralt is male; Ciri is female. Where a gender is unknown or absent, phrase neutrally rather than guess. Other text (UI, books, journal) is grup W3S.",
  '- Peasants and merchants address Geralt formally ("master witcher"); friends (Vesemir, Dandelion, Zoltan, Yennefer, Triss, Ciri) informally; royalty is addressed with honorifics.',
  '- Keep register differences: Velen peasant vernacular, noble hauteur, dwarven cursing, Skellige bluntness. Do not sanitize profanity.',
  '- Use the established names from the saga translation in the target language, not transliterations of the English or of another localization.',
  '- UI labels (menu, inventory, skills, Gwent cards) stay compact; do not turn them into prose.',
];

const witcherStyleUk = [
  '### СТИЛЬ, ТОН ТА АТМОСФЕРА (The Witcher 3):',
  '- Похмуре слов’янське фентезі за Сапковським. Не Fallout і не Creation Kit.',
  '- Рід мовця й адресата в репліках W3D — з speaker_gender / addressee_gender (дані сцен гри, авторитетні). Ґеральт — чоловічий, Цірі — жіночий; unknown — формулюй нейтрально.',
  '- Канон — офіційна українська локалізація гри: Любисток (не Лютик), Плітка (не Плотва), Дикий гін (не Дика Охота), Кер-Морен, Новіґрад, Скелліґе, Нільфґаард, Весемір, Реґіс, Єннефер, Цірі.',
  '- Селяни до Ґеральта — «ви», «пане відьмаче»; друзі — «ти»; монархи — «ваша величносте».',
];

export const witcher3Rules: GameRules = {
  en: (targetLang) => [
    ...witcherPlaceholdersEn,
    '',
    '### CAPITALIZATION:',
    '- Preserve the source capitalization pattern. ALL CAPS only when the entire source is ALL CAPS.',
    '',
    '### LINGUISTIC QUALITY:',
    `- Write fluent, idiomatic ${targetLang}. Avoid calques; keep dialogue speakable and UI compact.`,
    '',
    ...witcherStyleEn,
    '',
    ...formatCanonicalEnLines('THE WITCHER 3', WITCHER3_UK_GLOSSARY, targetLang),
  ],
  uk: () => [
    ...witcherStyleUk,
    '',
    ...formatCanonicalUkLines('THE WITCHER 3', WITCHER3_UK_GLOSSARY),
  ],
  verifyEn: () => [
    '### VERIFY — The Witcher 3:',
    '- Geralt in feminine grammatical gender, or Ciri in masculine → "incorrect".',
    '- Names taken from another localization or transliterated instead of the glossary canon → "suspicious".',
    '- Wrong T/V register for the relationship (a friend addressed formally, a peasant addressing Geralt with no deference the source shows) → "suspicious".',
    '- Lost or invented markup slot (<br>, <font>, {0}) → "incorrect".',
    '- A UI label expanded into a sentence → "suspicious".',
    '- These are .w3strings string tables, not a Bethesda plugin.',
  ],
  verifyUk: () => [
    '- Жіночий рід для Ґеральта або чоловічий для Цірі — "incorrect".',
    '- Російські чи транслітеровані форми замість канону (Лютик, Плотва, Дика Охота) — "suspicious".',
    '- Хибне «ти»/«ви» для стосунків персонажів — "suspicious".',
    '- Втрачений або вигаданий слот розмітки — "incorrect".',
  ],
};
