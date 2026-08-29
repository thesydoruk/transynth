import type { GlossaryEntry } from '../../../resources/glossary/types';

/** Ukrainian section header for canonical EN→UK terminology. */
export const canonicalUkHeader = (gameTitle: string): string =>
  `### КАНОНІЧНА ТЕРМІНОЛОГІЯ ${gameTitle} (за відсутності "glossary" у запиті):`;

/** English section header for canonical terminology. */
export const canonicalEnHeader = (gameTitle: string): string =>
  `### ${gameTitle} CANONICAL TERMINOLOGY (when no "glossary" in request):`;

/**
 * Format glossary entries as Ukrainian prompt bullets (EN → UK pairs).
 * Sorted longest-term-first so the model sees multi-word phrases before parts.
 */
export const formatCanonicalUkLines = (gameTitle: string, entries: GlossaryEntry[]): string[] => {
  if (entries.length === 0) return [];

  const sorted = [...entries].sort((a, b) => b.term.length - a.term.length);

  return [
    canonicalUkHeader(gameTitle),
    '- Не транслітеруй терміни нижче — використовуй точну українську форму (відмінюй за граматикою).',
    ...sorted.map(({ term, translation }) => `- ${term} → ${translation}`),
    '',
  ];
};

/**
 * Format glossary English terms for non-Ukrainian target prompts.
 * Lists every canonical source term the model must localize consistently.
 */
export const formatCanonicalEnLines = (
  gameTitle: string,
  entries: GlossaryEntry[],
  targetLang: string,
): string[] => {
  if (entries.length === 0) return [];

  const terms = [...new Set(entries.map((e) => e.term))].sort((a, b) => b.length - a.length);

  return [
    canonicalEnHeader(gameTitle),
    `- Localize every term below using established ${gameTitle} community canon in ${targetLang}; do not transliterate lore or item names phonetically.`,
    ...terms.map((term) => `- ${term}`),
    '',
  ];
};
