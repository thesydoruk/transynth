import type { NexusMod } from '../types';
import type { SortDirection, TranslationLanguage } from '../types';

export const uniqueStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
};

export const uniqueNumbers = (values: number[]): number[] => {
  const seen = new Set<number>();
  const result: number[] = [];

  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }

  return result;
};

export const normalizeLanguage = (language: TranslationLanguage | undefined): string | null => {
  if (!language) return null;
  const normalized = language.trim().toLowerCase();
  return normalized || null;
};

export const normalizeQuery = (value: string): string => {
  return value.replace(/\s+/g, ' ').trim();
};

export const normalizeSortDirection = (direction: SortDirection | undefined): SortDirection => {
  return direction ?? 'DESC';
};

export const normalizeTextForMatch = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const extractImportantTokens = (value: string): string[] => {
  const stopWords = new Set([
    'the',
    'and',
    'for',
    'with',
    'mod',
    'mods',
    'of',
    'a',
    'an',
    'to',
    'in',
    'on',
    'edition',
    'special',
  ]);

  return uniqueStrings(
    value
      .toLowerCase()
      .split(/[^a-z0-9а-яіїєґё]+/iu)
      .map((part) => part.trim())
      .filter((part) => part.length >= 3 && !stopWords.has(part)),
  );
};

export const countKeywordHits = (text: string, keywords: string[]): number => {
  let count = 0;

  for (const keyword of keywords) {
    const normalizedKeyword = normalizeTextForMatch(keyword);
    if (!normalizedKeyword) continue;
    if (text.includes(normalizedKeyword)) count += 1;
  }

  return count;
};

export const buildSourceNameSearchVariants = (sourceName: string): string[] => {
  const normalized = normalizeQuery(sourceName)
    .replace(/[._]+/g, ' ')
    .replace(/\s*-\s*.*/g, '')
    .trim();

  if (!normalized) return [];

  const variants = [normalized];
  variants.push(normalized.replace(/fallout\s*4/gi, 'F4'));
  variants.push(normalized.replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim());

  return uniqueStrings(variants)
    .map((value) => normalizeQuery(value))
    .filter((value) => value.length >= 6)
    .slice(0, 4);
};

export const mergeUniqueModsByGameAndModId = (mods: NexusMod[]): NexusMod[] => {
  const result: NexusMod[] = [];
  const seen = new Set<string>();

  for (const mod of mods) {
    const key = `${mod.game.domainName}/${mod.modId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(mod);
  }

  return result;
};

export const isLikelyTranslationCategory = (category: string | null): boolean => {
  if (!category) return false;
  const normalized = normalizeTextForMatch(category);
  return (
    normalized.includes('translation') ||
    normalized.includes('localization') ||
    normalized.includes('localisation') ||
    normalized.includes('language')
  );
};

export const containsAdultStyleTerms = (value: string): boolean => {
  const normalized = normalizeTextForMatch(value);
  const terms = [
    'adult',
    'nsfw',
    'nude',
    'sexy',
    'bodyslide',
    'cbbe',
    'outfit',
    'bikini',
    'followers',
    'preset',
    'beauty',
  ];
  return terms.some((term) => normalized.includes(term));
};
