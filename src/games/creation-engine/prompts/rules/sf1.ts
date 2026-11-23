import { SF1_UK_GLOSSARY } from '../../data/glossary/sf1-uk';
import {
  formatCanonicalEnLines,
  formatCanonicalUkLines,
} from '../../../../llm/prompts/translationRules/canonical';
import type { GameRules } from '../../../../llm/prompts/translationRules/types';

export const sf1Rules: GameRules = {
  en: (targetLang) => [
    '### STYLE, TONE, AND ATMOSPHERE (Starfield):',
    '- Setting: the Settled Systems, 2330. Space exploration, ships, outposts and planets; the player is a member of Constellation and is often addressed as "Captain".',
    '- Dialogue: grounded science fiction; lighter and more hopeful than Fallout, rough for pirates and mercenaries.',
    '- UI/items: ship modules, spacesuits, weapons, resources — terse inventory style; keep model designations as they are.',
    "- Terminals (TMLM) and slates (BOOK): logs, letters and reports in their author's voice.",
    '',
    ...formatCanonicalEnLines('STARFIELD', SF1_UK_GLOSSARY, targetLang),
    '- Do not use Fallout or Elder Scrolls vocabulary (caps, vault, Pip-Boy, magicka) unless it is in the source.',
    '',
    '### TRANSLATION EXAMPLES (Starfield):',
    '- "That\'ll be 500 credits." → natural spoken ' + targetLang + ' with the canonical currency.',
  ],
  uk: () => [
    '### СТИЛЬ, ТОН ТА АТМОСФЕРА (Starfield):',
    "- Сетинг: Заселені системи, 2330 рік. Освоєння космосу, кораблі, аванпости, планети; гравець — член Сузір'я, до нього часто звертаються «Капітане».",
    '- Діалоги: наукова фантастика без постапокаліпсису; тон світліший, ніж у Fallout, грубий у піратів і найманців.',
    '- UI/предмети: модулі корабля, скафандри, зброя, ресурси — стисло; позначення моделей не змінюй.',
    '- Термінали (TMLM) і слейти (BOOK): журнали, листи, звіти — тон автора.',
    '',
    ...formatCanonicalUkLines('STARFIELD', SF1_UK_GLOSSARY),
    '- Не використовуй лексику Fallout чи The Elder Scrolls (кришки, Сховище, Піп-бой, магія) без підстави в source.',
    '',
    '### ПРИКЛАДИ (Starfield):',
    '- "That\'ll be 500 credits." → "З вас 500 кредитів."',
    '- "Welcome to New Atlantis." → "Ласкаво просимо до Нової Атлантиди."',
  ],
  verifyUk: () => [
    '- Лексика інших ігор Bethesda без підстави в source — "incorrect".',
    '- Транслітерація замість канонічного терміну зі списку вище — "suspicious" або "incorrect".',
  ],
};
