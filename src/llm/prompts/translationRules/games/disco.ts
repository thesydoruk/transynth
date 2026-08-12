import { DISCO_UK_GLOSSARY } from '../../../../resources/glossary/disco-uk';
import { formatCanonicalEnLines, formatCanonicalUkLines } from '../canonical';
import type { GameRules } from '../types';

export const discoRules: GameRules = {
  en: (targetLang) => [
    '### STYLE, TONE, AND ATMOSPHERE (Disco Elysium):',
    '- Setting: failing coastal district Martinaise in Revachol — political noir, surreal internal monologue, tragic comedy.',
    '- Skills speak as distinct voices (Inland Empire, Volition, Electrochemistry, etc.) with unique diction.',
    '- Dialogue mixes bureaucracy, street slang, poetry, and philosophical digression; keep register shifts.',
    '- UI/Thought Cabinet: keep skill names and proper nouns consistent with the glossary.',
    '',
    ...formatCanonicalEnLines('DISCO ELYSIUM', DISCO_UK_GLOSSARY, targetLang),
    '- Preserve gettext placeholders and markup (%s, {0}, HTML-like tags, newlines).',
    '',
    '### TRANSLATION EXAMPLES (Disco Elysium):',
    '- Skill lines: keep the skill identity clear; do not flatten into generic NPC speech.',
  ],
  uk: () => [
    '### СТИЛЬ, ТОН ТА АТМОСФЕРА (Disco Elysium):',
    '- Сетинг: Мартінез у Ревашолі — політичний нуар, сюрреалістичний внутрішній монолог, трагікомедія.',
    '- Навички говорять окремими голосами (Внутрішня імперія, Воля, Електрохімія тощо) з власним регістром.',
    '- Діалоги змішують бюрократію, вуличний сленг, поезію й філософію — зберігай зміну регістрів.',
    '- UI / Кабінет думок: назви навичок і власні імена — за глосарієм.',
    '',
    ...formatCanonicalUkLines('DISCO ELYSIUM', DISCO_UK_GLOSSARY),
    '- Зберігай плейсхолдери gettext і розмітку (%s, {0}, теги, переноси рядків).',
    '',
    '### ПРИКЛАДИ (Disco Elysium):',
    '- Репліки навичок не зводь до «звичайного NPC» — голос навички має лишатися впізнаваним.',
  ],
  verifyUk: () => [
    '- Якщо репліка навички звучить як нейтральний NPC без характерного голосу — "suspicious".',
    '- Транслітерація замість канонічного терміну зі списку вище — "suspicious" або "incorrect".',
    '- Власні назви (Ревашоль, Кім Кіцураґі, Мартінез) мають відповідати глосарію.',
  ],
};
