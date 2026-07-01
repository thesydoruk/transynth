import type { GlossaryEntry } from './types';
import { FO4_UK_GLOSSARY } from './fo4-uk';

/** FO76-specific canonical terms (shared Fallout terms come from FO4 glossary). */
const FO76_SPECIFIC_UK: GlossaryEntry[] = [
  { term: 'Responders', translation: 'Рятувальники' },
  { term: 'Free States', translation: 'Вільні штати' },
  { term: 'Scorched', translation: 'Опалені' },
  { term: 'Scorchbeast', translation: 'Опалений зверь' },
  { term: 'Grafton Monster', translation: 'Графтонський монстр' },
  { term: 'Mole Miner', translation: 'Кротовий шахтар' },
  { term: 'Snallygaster', translation: 'Снеллігастер' },
  { term: 'C.A.M.P.', translation: 'C.A.M.P.' },
  { term: 'Public Workshop', translation: 'Публічна майстерня' },
  { term: 'Appalachia', translation: 'Аппалачі' },
];

const mergeGlossaries = (...lists: GlossaryEntry[][]): GlossaryEntry[] => {
  const byTerm = new Map<string, GlossaryEntry>();
  for (const list of lists) {
    for (const entry of list) {
      byTerm.set(entry.term.toLowerCase(), entry);
    }
  }
  return [...byTerm.values()].sort((a, b) => a.term.localeCompare(b.term));
};

/** Canonical Fallout 76 EN→UK terminology (FO4 base + Appalachia-specific). */
export const FO76_UK_GLOSSARY: GlossaryEntry[] = mergeGlossaries(FO4_UK_GLOSSARY, FO76_SPECIFIC_UK);
