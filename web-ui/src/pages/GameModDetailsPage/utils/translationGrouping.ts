import type { NexusTranslationCandidate } from '../../../api';

export type TranslationLanguageKey =
  | 'ukrainian'
  | 'russian'
  | 'polish'
  | 'german'
  | 'french'
  | 'spanish'
  | 'portuguese'
  | 'brazilianPortuguese'
  | 'italian'
  | 'dutch'
  | 'swedish'
  | 'norwegian'
  | 'danish'
  | 'finnish'
  | 'czech'
  | 'slovak'
  | 'slovenian'
  | 'hungarian'
  | 'romanian'
  | 'croatian'
  | 'serbian'
  | 'bulgarian'
  | 'greek'
  | 'turkish'
  | 'japanese'
  | 'korean'
  | 'chinese'
  | 'thai'
  | 'vietnamese'
  | 'indonesian'
  | 'english'
  | 'unknown';

export type TranslationGroup = {
  key: TranslationLanguageKey;
  labelKey: string;
  flagImageUrl: string | null;
  items: NexusTranslationCandidate[];
  topScore: number;
};

const LANGUAGE_SPECS: Array<{
  key: Exclude<TranslationLanguageKey, 'unknown'>;
  countryCode: string;
  patterns: string[];
}> = [
  {
    key: 'ukrainian',
    countryCode: 'ua',
    patterns: ['ukrainian', 'ukraine', 'україн', 'укр', 'ua'],
  },
  { key: 'russian', countryCode: 'ru', patterns: ['russian', 'рус', 'руськ', 'ru'] },
  { key: 'polish', countryCode: 'pl', patterns: ['polish', 'polski', 'polska', 'pl'] },
  { key: 'german', countryCode: 'de', patterns: ['german', 'deutsch', 'de'] },
  { key: 'french', countryCode: 'fr', patterns: ['french', 'francais', 'français', 'fr'] },
  { key: 'spanish', countryCode: 'es', patterns: ['spanish', 'espanol', 'español', 'es'] },
  {
    key: 'portuguese',
    countryCode: 'pt',
    patterns: ['portuguese', 'portugues', 'português', 'pt'],
  },
  {
    key: 'brazilianPortuguese',
    countryCode: 'br',
    patterns: ['brazilian portuguese', 'pt br', 'pt-br', 'brasil', 'brasileiro'],
  },
  { key: 'italian', countryCode: 'it', patterns: ['italian', 'italiano', 'it'] },
  { key: 'dutch', countryCode: 'nl', patterns: ['dutch', 'nederlands', 'nl'] },
  { key: 'swedish', countryCode: 'se', patterns: ['swedish', 'svenska', 'sv'] },
  { key: 'norwegian', countryCode: 'no', patterns: ['norwegian', 'norsk', 'no'] },
  { key: 'danish', countryCode: 'dk', patterns: ['danish', 'dansk', 'da'] },
  { key: 'finnish', countryCode: 'fi', patterns: ['finnish', 'suomi', 'fi'] },
  { key: 'czech', countryCode: 'cz', patterns: ['czech', 'cestina', 'čeština', 'cz'] },
  { key: 'slovak', countryCode: 'sk', patterns: ['slovak', 'slovencina', 'slovenčina', 'sk'] },
  {
    key: 'slovenian',
    countryCode: 'si',
    patterns: ['slovenian', 'slovenscina', 'slovenščina', 'sl'],
  },
  { key: 'hungarian', countryCode: 'hu', patterns: ['hungarian', 'magyar', 'hu'] },
  { key: 'romanian', countryCode: 'ro', patterns: ['romanian', 'romana', 'română', 'ro'] },
  { key: 'croatian', countryCode: 'hr', patterns: ['croatian', 'hrvatski', 'hr'] },
  { key: 'serbian', countryCode: 'rs', patterns: ['serbian', 'srpski', 'sr'] },
  { key: 'bulgarian', countryCode: 'bg', patterns: ['bulgarian', 'български', 'bg'] },
  { key: 'greek', countryCode: 'gr', patterns: ['greek', 'ελληνικά', 'el'] },
  { key: 'turkish', countryCode: 'tr', patterns: ['turkish', 'turkce', 'türkçe', 'tr'] },
  { key: 'japanese', countryCode: 'jp', patterns: ['japanese', '日本語', 'jp'] },
  { key: 'korean', countryCode: 'kr', patterns: ['korean', '한국어', 'kr'] },
  { key: 'chinese', countryCode: 'cn', patterns: ['chinese', '中文', 'zh', 'cn'] },
  { key: 'thai', countryCode: 'th', patterns: ['thai', 'ไทย', 'th'] },
  {
    key: 'vietnamese',
    countryCode: 'vn',
    patterns: ['vietnamese', 'tieng viet', 'tiếng việt', 'vi'],
  },
  { key: 'indonesian', countryCode: 'id', patterns: ['indonesian', 'bahasa indonesia', 'id'] },
  { key: 'english', countryCode: 'gb', patterns: ['english', 'eng', 'en'] },
];

const TRANSLATION_WORD_LANGUAGE_HINTS: Array<{
  key: Exclude<TranslationLanguageKey, 'unknown'>;
  patterns: string[];
}> = [
  { key: 'ukrainian', patterns: ['переклад', 'українізатор'] },
  { key: 'russian', patterns: ['перевод'] },
  { key: 'polish', patterns: ['tlumaczenie', 'tłumaczenie'] },
  { key: 'german', patterns: ['ubersetzung', 'übersetzung'] },
  { key: 'french', patterns: ['traduction'] },
  { key: 'spanish', patterns: ['traduccion', 'traducción'] },
  { key: 'portuguese', patterns: ['traducao', 'tradução'] },
  { key: 'italian', patterns: ['traduzione'] },
  { key: 'hungarian', patterns: ['forditas', 'fordítás'] },
  { key: 'czech', patterns: ['preklad', 'překlad'] },
  { key: 'turkish', patterns: ['ceviri', 'çeviri'] },
  { key: 'greek', patterns: ['μετάφραση', 'μεταφραση'] },
  { key: 'japanese', patterns: ['翻訳'] },
  { key: 'korean', patterns: ['번역'] },
  { key: 'chinese', patterns: ['翻译', '翻譯'] },
  { key: 'thai', patterns: ['แปล'] },
  { key: 'vietnamese', patterns: ['ban dich', 'bản dịch'] },
  { key: 'english', patterns: ['translation'] },
];

export const groupTranslationsByLanguage = (
  items: NexusTranslationCandidate[],
): TranslationGroup[] => {
  const groups = new Map<TranslationLanguageKey, TranslationGroup>();

  for (const row of items) {
    const key = detectTranslationLanguage(row.mod);
    const existing = groups.get(key);

    if (existing) {
      existing.items.push(row);
      existing.topScore = Math.max(existing.topScore, row.score);
      continue;
    }

    const spec = LANGUAGE_SPECS.find((entry) => entry.key === key);
    groups.set(key, {
      key,
      labelKey: `games.language.${key}`,
      flagImageUrl: spec ? getFlagImageUrl(spec.countryCode) : null,
      items: [row],
      topScore: row.score,
    });
  }

  return [...groups.values()]
    .filter((group) => group.key !== 'unknown')
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => b.score - a.score),
    }))
    .sort((a, b) => {
      if (b.topScore !== a.topScore) return b.topScore - a.topScore;
      return a.labelKey.localeCompare(b.labelKey);
    });
};

const detectTranslationLanguage = (
  mod: NexusTranslationCandidate['mod'],
): TranslationLanguageKey => {
  const normalizedTags = mod.tags.map((tag) => normalizeForLanguageMatch(tag));
  const haystack = normalizeForLanguageMatch(`${mod.name} ${mod.summary} ${mod.category ?? ''}`);

  for (const spec of LANGUAGE_SPECS) {
    if (
      normalizedTags.some((tag) =>
        spec.patterns.some((pattern) => textMatchesLanguagePattern(tag, pattern)),
      )
    ) {
      return spec.key;
    }
  }

  for (const spec of LANGUAGE_SPECS) {
    if (spec.patterns.some((pattern) => textMatchesLanguagePattern(haystack, pattern))) {
      return spec.key;
    }
  }

  const byTranslationWord = detectLanguageByTranslationWord(haystack);
  if (byTranslationWord) {
    return byTranslationWord;
  }

  return 'unknown';
};

const detectLanguageByTranslationWord = (
  normalizedText: string,
): Exclude<TranslationLanguageKey, 'unknown'> | null => {
  for (const spec of TRANSLATION_WORD_LANGUAGE_HINTS) {
    if (spec.patterns.some((pattern) => textMatchesLanguagePattern(normalizedText, pattern))) {
      return spec.key;
    }
  }

  return null;
};

const normalizeForLanguageMatch = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const textMatchesLanguagePattern = (normalizedText: string, rawPattern: string): boolean => {
  const pattern = normalizeForLanguageMatch(rawPattern);
  if (!pattern) return false;

  if (pattern.length <= 2) {
    const tokens = normalizedText.split(' ').filter(Boolean);
    return tokens.includes(pattern);
  }

  return normalizedText.includes(pattern);
};

const getFlagImageUrl = (countryCode: string): string => {
  const cc = countryCode.toLowerCase();
  return `https://flagcdn.com/w20/${cc}.png`;
};
