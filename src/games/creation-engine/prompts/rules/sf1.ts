import { SF1_UK_GLOSSARY } from '../../data/glossary/sf1-uk';
import {
  SF1_UK_CANON_TRAPS,
  SF1_UK_PLAYER,
  SF1_UK_REGISTER,
  SF1_UK_REGISTER_VERIFY,
  SF1_UK_TONE,
  SF1_UK_VOICES,
} from '../sf1/layers';
import {
  formatCanonicalEnLines,
  formatCanonicalUkLines,
} from '../../../../llm/prompts/translationRules/canonical';
import type { GameRules } from '../../../../llm/prompts/translationRules/types';

export const sf1Rules: GameRules = {
  en: (targetLang) => [
    '### STYLE, TONE, AND ATMOSPHERE (Starfield):',
    '- Setting: the Settled Systems, 2330. "NASA-punk": restrained, warm, professional science fiction about explorers — not post-apocalypse and not fantasy. Swearing is milder than in Fallout and stays with pirates, Spacers and the Neon street.',
    '- Dialogue (INFO): spoken lines in the voice of the character and faction; accents are carried by word choice and rhythm, never by broken spelling.',
    '- UI/items: ship modules, spacesuits, weapons, resources — one naming pattern per series, terse; keep model designations as they are.',
    "- Terminals (TMLM) and slates (BOOK): logs, letters and reports in their author's voice; terminal menu items stay short labels.",
    '- Quests: objectives are short imperatives in the informal singular; journal entries are first person and gender-neutral.',
    '',
    '### THE PLAYER AND SECOND-PERSON REGISTER (Starfield):',
    '- The protagonist is silent and every player reads the same text (pronouns he / she / they). A line spoken by the player (speaker "Player", gender "any") or addressed to the player must not mark the player\'s gender: recast it (present tense, imperative, a noun, an impersonal construction). No slash forms, no two genders side by side.',
    '- This overrides the shared rule above: never switch to the formal or plural "you" only to hide gender. Formal or informal "you" is chosen by the character, and a speaker–addressee pair keeps one register in every scene, both ways.',
    '- Informal "you": Constellation, companions and hired crew, the Freestar Collective, the Crimson Fleet, Spacers, Ecliptic, enemies in combat, the Neon street, miners and workers, the Hunter and the Emissary, children.',
    '- Formal "you": UC government and command, corporations (Ryujin Industries, GalBank), House Va\'ruun officials, vendors and staff to a customer, doctors, robots and AI (Vasco, the ship computer), Keeper Aquilus, the Adoring Fan. Real plurals stay plural.',
    '- "Captain" addressed to the player takes a form that does not mark gender. Tags that open a player line ([Persuade], [Attack], [Lie]) are translated and keep their brackets.',
    '',
    ...formatCanonicalEnLines('STARFIELD', SF1_UK_GLOSSARY, targetLang),
    '- Do not use Fallout or Elder Scrolls vocabulary (caps, vault, Pip-Boy, magicka) unless it is in the source.',
    '',
    '### TRANSLATION EXAMPLES (Starfield):',
    '- "Are you ready?" from a Constellation companion → informal, recast so that no gender shows ("Shall we start?").',
    '- "Find the Artifact" (quest objective) → informal imperative in ' + targetLang + '.',
  ],
  uk: () => [
    '### СТИЛЬ, ТОН ТА АТМОСФЕРА (Starfield):',
    '- Сетинг: Заселені системи, 2330 рік. Не постапокаліпсис і не фентезі.',
    SF1_UK_TONE,
    SF1_UK_VOICES,
    SF1_UK_PLAYER,
    SF1_UK_REGISTER,
    SF1_UK_CANON_TRAPS,
    '- Цілі квестів — наказ на "ти"; журнал — від першої особи без роду; назви й інтерфейс — один шаблон на серію; термінали й слейти — голос автора.',
    '',
    ...formatCanonicalUkLines('STARFIELD', SF1_UK_GLOSSARY),
    '### ПРИКЛАДИ (Starfield):',
    '- "Are you ready?" (супутник до героя) → "Можемо починати?"',
    '- "Find the Artifact" (ціль квесту) → "Знайди Артефакт"',
  ],
  verifyUk: () => [
    '- Транслітерація замість канонічного терміна зі списку вище — "suspicious"; груба підміна ключової сутності або лексика Fallout чи The Elder Scrolls без підстави в source — "incorrect".',
    SF1_UK_REGISTER_VERIFY,
  ],
};
