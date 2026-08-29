import { FO3_UK_GLOSSARY } from '../../../../resources/glossary/fo3-uk';
import { formatCanonicalEnLines, formatCanonicalUkLines } from '../canonical';
import type { GameRules } from '../types';

export const fo3Rules: GameRules = {
  en: (targetLang) => [
    '### STYLE, TONE, AND ATMOSPHERE (Fallout 3):',
    '- Setting: Capital Wasteland (DC ruins), 2277. Bleaker, more desperate tone than New Vegas; survival and hope amid ruin.',
    '- Dialogue: direct, often grim; Project Purity and Brotherhood themes recur.',
    '- UI/items: concise wasteland survival phrasing.',
    '',
    ...formatCanonicalEnLines('FALLOUT 3', FO3_UK_GLOSSARY, targetLang),
    '- Super Mutants in FO3 originate from FEV — terminology consistent with Capital Wasteland lore.',
    '- No Institute, NCR, or Mojave-specific terms unless in source.',
    '',
    '### TRANSLATION EXAMPLES (Fallout 3):',
    '- "Welcome to Megaton." → natural ' + targetLang + ' using canonical location names.',
  ],
  uk: () => [
    '### СТИЛЬ, ТОН ТА АТМОСФЕРА (Fallout 3):',
    '- Сетинг: Столична пустка (руїни Вашингтона), 2277. Більш похмурий і відчайдушний тон, ніж у New Vegas.',
    '- Діалоги: прямолінійні, подекуди жорсткі; теми Братства та «Проєкту Чистоти».',
    '- UI/предмети: стисла лексика виживання в пустці.',
    '',
    ...formatCanonicalUkLines('FALLOUT 3', FO3_UK_GLOSSARY),
    '- Не використовуй терміни Fallout 4 (Синт, Інститут) або New Vegas (НКР, Легіон), якщо їх немає в source.',
    '',
    '### ПРИКЛАДИ (Fallout 3):',
    '- "Welcome to Megaton." → "Ласкаво просимо до Мегатону."',
    '- "Project Purity must succeed." → похмурий, сподіваючий тон основного сюжету.',
  ],
  verifyUk: () => [
    '- Терміни з інших частин серії Fallout без підстави в source — "suspicious" або "incorrect".',
    '- Транслітерація замість канонічного терміну зі списку вище — "suspicious" або "incorrect".',
  ],
};
