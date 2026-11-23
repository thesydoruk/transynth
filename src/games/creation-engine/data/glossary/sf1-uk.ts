/**
 * Starfield English → Ukrainian glossary seed.
 *
 * Starfield has no official Ukrainian release, so there is no canon to copy:
 * this is a short draft of names and terms with one obvious rendering, for the
 * owner to review. The production glossary in the DB is the source of truth
 * once it exists.
 *
 * Loaded by `scripts/seedGlossary.ts` (`npm run db:seed:glossary`).
 */

import type { GlossaryEntry } from '../../../../resources/glossary/types';

export type { GlossaryEntry } from '../../../../resources/glossary/types';

export const SF1_UK_GLOSSARY: GlossaryEntry[] = [
  { term: 'Constellation', translation: "Сузір'я" },
  { term: 'United Colonies', translation: "Об'єднані колонії" },
  { term: 'Crimson Fleet', translation: 'Багряний флот' },
  { term: 'The Enlightened', translation: 'Просвітлені' },
  { term: 'Ecliptic', translation: 'Екліптика' },
  { term: 'Vanguard', translation: 'Авангард' },
  { term: 'Settled Systems', translation: 'Заселені системи' },
  { term: 'New Atlantis', translation: 'Нова Атлантида' },
  { term: 'Jemison', translation: 'Джемісон' },
  { term: 'Neon', translation: 'Неон' },
  { term: 'The Unity', translation: 'Єдність' },
  { term: 'Mantis', translation: 'Богомол' },
  { term: 'Grav Drive', translation: 'гравітаційний рушій' },
  { term: 'Outpost', translation: 'аванпост' },
  { term: 'Spacesuit', translation: 'скафандр' },
  { term: 'Credits', translation: 'кредити' },
  { term: 'Contraband', translation: 'контрабанда' },
];
