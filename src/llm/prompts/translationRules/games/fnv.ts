import type { GameRules } from '../types';

export const fnvRules: GameRules = {
  en: () => [
    '### STYLE, TONE, AND ATMOSPHERE (Fallout: New Vegas):',
    '- Setting: Mojave Wasteland, 2281. Blend post-apocalyptic grit with western, noir, and Vegas glamour; factions have distinct voices (NCR bureaucracy, Legion antiquity, Strip excess).',
    '- Dialogue: sharp, character-driven; many lines are rhetorical, sardonic, or theatrical — preserve speaker personality.',
    '- UI/items: concise; weapon mod names and casino terms should feel native to the target language.',
    '',
    '### FALLOUT: NEW VEGAS TERMINOLOGY (when no glossary):',
    '- Economy: caps; rads, HP, AP as in Fallout.',
    "- Factions: NCR, Caesar's Legion, New California Republic, Mr. House, Three Families (Omertas, Chairmen, White Glove Society), Boomers, Great Khans, Powder Gangers.",
    '- Locations: New Vegas, Strip, Hoover Dam, Goodsprings, Primm, Novac, Boulder City, Red Rock Canyon, The Fort.',
    '- Creatures: Cazador, Night Stalker, Fire Gecko, Deathclaw, Feral Ghoul — same Fallout bestiary with Mojave-specific threats.',
    '- Unique tone: Legion uses formal archaic register in English; NCR uses military/bureaucratic diction; Vegas factions use slick or criminal slang.',
    '- Do not use Fallout 4–specific factions (Institute, Minutemen, Railroad) unless they appear in source.',
  ],
  uk: () => [
    '### СТИЛЬ, ТОН ТА АТМОСФЕРА (Fallout: New Vegas):',
    '- Сетинг: Пустка Мохаве, 2281. Поєднання постапокаліпсису, вестерну, нуару та блиску Вегасу; у кожної фракції свій голос.',
    '- Діалоги: характерні, гострі, часто саркастичні чи театральні — зберігай індивідуальність мовця.',
    '- UI/предмети: стисло; назви модифікацій зброї та казино-лексика звучать природно українською.',
    '',
    '### КАНОНІЧНА ТЕРМІНОЛОГІЯ FALLOUT: NEW VEGAS (за відсутності "glossary"):',
    '- caps → кришки; stimpak → стимулятор; rads → радіація; стандартна лексика Fallout.',
    "- Фракції: NCR → НКР (Нова Каліфорнійська Республіка); Caesar's Legion → Легіон Цезаря; Mr. House → містер Хаус; Boomers → Бумери; Great Khans → Великі хани; Powder Gangers → Порохачі.",
    "- Сім'ї Стріпу: Omertas → Омерти; Chairmen → Голови; White Glove Society → Товариство Білої Рукавички.",
    '- Локації: New Vegas → Нью-Вегас; The Strip → Стріп; Hoover Dam → Гребля Гувера; Goodsprings → Гудспрінгс; Novac → Новач; Primm → Прімм.',
    '- Істоти: Cazador → Казадор; Night Stalker → Нічний переслідувач; Fire Gecko → Вогняний геккон.',
    '- Легіон: формальний, архаїчний регістр у діалогах; НКР — військово-бюрократичний; Вегас — кримінальний або глянцевий сленг.',
    '- Не використовуй терміни Fallout 4 (Інститут, Мінітмени, Підземка), якщо їх немає в source.',
  ],
  verifyUk: () => [
    '- Плутанина термінології Fallout 4 і New Vegas (напр. Інститут у Мохаве) — "incorrect".',
    '- Регістр Легіону/NCR має відповідати фракції мовця.',
  ],
};
