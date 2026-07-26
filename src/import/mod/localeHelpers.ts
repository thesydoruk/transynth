import { MCM_LOCALE_ALIASES } from '../../formats/mcm';

const resolveAvailableLocale = <T>(
  locales: Map<string, T>,
  requestedLang: string,
): { resolvedKey: string; value: T } | null => {
  const requested = requestedLang.trim().toLowerCase();
  if (!requested) return null;

  const aliases = MCM_LOCALE_ALIASES;

  const candidates = aliases.get(requested) ?? [requested];
  for (const candidate of candidates) {
    const value = locales.get(candidate);
    if (value !== undefined) {
      return { resolvedKey: candidate, value };
    }
  }

  for (const [localeKey, aliasList] of aliases) {
    if (!aliasList.includes(requested)) continue;
    const value = locales.get(localeKey);
    if (value !== undefined) {
      return { resolvedKey: localeKey, value };
    }
  }

  return null;
};

/** Default source language when a mod has no external locale files. */
export const MOD_IMPORT_DEFAULT_SOURCE_LOCALE = 'en';

/** True when the job should ingest every locale present in the mod. */
export const isImportAllLocalesRequest = (srcLang: string): boolean => {
  const normalized = srcLang.trim().toLowerCase();
  return normalized === '' || normalized === 'en' || normalized === 'english';
};

/** Normalize a locale code via {@link MCM_LOCALE_ALIASES} for equality checks. */
const normalizeLocaleAlias = (lang: string): string => {
  const lower = lang.trim().toLowerCase();
  if (!lower) return lower;

  for (const [key, aliases] of MCM_LOCALE_ALIASES) {
    if (key === lower || aliases.includes(lower)) return key;
  }

  return lower;
};

const resolveSingleImportLocale = (
  locales: Map<string, unknown>,
  srcLang: string,
): string | null => {
  if (isImportAllLocalesRequest(srcLang)) return null;
  return resolveAvailableLocale(locales, srcLang)?.resolvedKey ?? null;
};

/** Language tag used for non-localized plugin strings and PEX literals. */
const resolveModStringsLang = (requestedLang: string | null | undefined): string => {
  const trimmed = requestedLang?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : MOD_IMPORT_DEFAULT_SOURCE_LOCALE;
};

export {
  resolveAvailableLocale,
  normalizeLocaleAlias,
  resolveSingleImportLocale,
  resolveModStringsLang,
};
