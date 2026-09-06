/** Cyrillic + Ukrainian ґ. Latin / punctuation stay as-is. */
const CYRILLIC_RE = /[\u0400-\u04FF]/;

/** Two-letter Ukrainian clusters that must not go through the single-letter map. */
const DIGRAPHS: ReadonlyArray<readonly [string, string]> = [
  ['дж', 'j'],
  ['дз', 'dz'],
];

/**
 * Ukrainian (and leftover Russian) letters → English spellings Fonix USEnglish
 * will roughly pronounce. Not ISO transliteration: `и` is `ih`, not `y`.
 */
const LETTERS: Readonly<Record<string, string>> = {
  а: 'ah',
  б: 'b',
  в: 'v',
  г: 'h',
  ґ: 'g',
  д: 'd',
  е: 'eh',
  є: 'yeh',
  ж: 'zh',
  з: 'z',
  и: 'ih',
  і: 'ee',
  ї: 'yee',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'oh',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'oo',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ь: '',
  ю: 'yoo',
  я: 'yah',
  ъ: '',
  ы: 'ih',
  э: 'eh',
  ё: 'yoh',
};

const APOSTROPHE = new Set(["'", '’', 'ʼ', '`']);

/**
 * Respell Ukrainian dialogue so stock FaceFX / Fonix can read it as English
 * phonemes. ASCII-only lines are returned unchanged.
 */
export const adaptUkrainianForFonix = (text: string): string => {
  const src = text.normalize('NFC');
  if (!CYRILLIC_RE.test(src)) return src;

  const title = (mapped: string, original: string): string => {
    const first = original[0];
    if (!first || first === first.toLowerCase() || !mapped) return mapped;
    return mapped[0].toUpperCase() + mapped.slice(1);
  };

  let out = '';
  const lower = src.toLowerCase();
  for (let i = 0; i < src.length; i += 1) {
    const pair = lower.slice(i, i + 2);
    const digraph = DIGRAPHS.find(([from]) => from === pair);
    if (digraph) {
      out += title(digraph[1], src.slice(i, i + 2));
      i += 1;
      continue;
    }
    const ch = lower[i] ?? '';
    if (APOSTROPHE.has(ch)) continue;
    if (Object.prototype.hasOwnProperty.call(LETTERS, ch)) {
      out += title(LETTERS[ch] ?? '', src[i] ?? '');
      continue;
    }
    out += src[i];
  }
  return out.replace(/\s+/g, ' ').trim();
};
