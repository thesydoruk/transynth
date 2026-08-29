import { FNV_UK_GLOSSARY } from '../../../../resources/glossary/fnv-uk';
import { formatCanonicalEnLines, formatCanonicalUkLines } from '../canonical';
import type { GameRules } from '../types';

export const fnvRules: GameRules = {
  en: (targetLang) => [
    '### STYLE, TONE, AND ATMOSPHERE (Fallout: New Vegas):',
    '- Setting: Mojave Wasteland, 2281. Blend post-apocalyptic grit with western, noir, and Vegas glamour; factions have distinct voices (NCR bureaucracy, Legion antiquity, Strip excess).',
    '- Dialogue: sharp, character-driven; many lines are rhetorical, sardonic, or theatrical — preserve speaker personality.',
    '- UI/items: concise; weapon mod names and casino terms should feel native to the target language.',
    '',
    ...formatCanonicalEnLines('FALLOUT: NEW VEGAS', FNV_UK_GLOSSARY, targetLang),
    '- Unique tone: Legion uses formal archaic register in English; NCR uses military/bureaucratic diction; Vegas factions use slick or criminal slang.',
    '- Do not use Fallout 4–specific factions (Institute, Minutemen, Railroad) unless they appear in source.',
    '',
    '### TRANSLATION EXAMPLES (New Vegas):',
    '- "The Legion awaits, courier." → preserve Legion register in ' + targetLang + '.',
  ],
  uk: () => [
    '### СТИЛЬ, ТОН ТА АТМОСФЕРА (Fallout: New Vegas):',
    '- Сетинг: Пустка Мохаве, 2281. Поєднання постапокаліпсису, вестерну, нуару та блиску Вегасу; у кожної фракції свій голос.',
    '- Діалоги: характерні, гострі, часто саркастичні чи театральні — зберігай індивідуальність мовця.',
    '- UI/предмети: стисло; назви модифікацій зброї та казино-лексика звучать природно українською.',
    '',
    ...formatCanonicalUkLines('FALLOUT: NEW VEGAS', FNV_UK_GLOSSARY),
    '- Легіон: формальний, архаїчний регістр у діалогах; НКР — військово-бюрократичний; Вегас — кримінальний або глянцевий сленг.',
    '- Не використовуй терміни Fallout 4 (Інститут, Мінітмени, Підземка), якщо їх немає в source.',
    '',
    '### ПРИКЛАДИ (New Vegas):',
    '- "The Legion awaits, courier." → урочистий регістр Легіону; "courier" → кур\'єр.',
    '- "NCR tax collector" → "Податковий інспектор НКР" (бюрократичний тон).',
    '- "Vegas, baby!" → блиск Стріпу, не буквальна калька.',
  ],
  verifyUk: () => [
    '- Плутанина термінології Fallout 4 і New Vegas (напр. Інститут у Мохаве) — "incorrect".',
    '- Регістр Легіону/NCR має відповідати фракції мовця.',
    '- Транслітерація замість канонічного терміну зі списку вище — "suspicious" або "incorrect".',
  ],
};
