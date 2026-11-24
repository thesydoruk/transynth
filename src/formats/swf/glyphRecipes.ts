/**
 * How each letter of a language is obtained for a font that lacks it.
 *
 * A letter is taken, in order of preference, from:
 * - `same`: a glyph the font itself draws — the Latin twin of a Cyrillic letter
 *   («А» is «A» in every sans), or a letter added a moment earlier («Ґ» is «Г» with
 *   an upturn). The font's own design, exactly.
 * - `donor`: the same letter in a donor font — the game's own Japanese set carries
 *   Russian Cyrillic for every face of the Latin set — fitted to the font's cap
 *   height, stem weight and spacing. `left` / `right` name Latin letters whose
 *   side bearings the new letter copies: «Б» starts like «E» and ends like «B».
 *
 * Recipes run in table order, so a `same` recipe may use a letter an earlier recipe
 * added. Letters listed only in `extra` are punctuation: worth adding, but a font is
 * not judged unusable without them.
 */

export type GlyphTransform = 'mirror' | 'upturn' | 'dash' | 'ellipsis';

export type GlyphRecipe =
  | { kind: 'same'; from: string; transform?: GlyphTransform }
  | { kind: 'donor'; from?: string; transform?: 'mirror'; left: string; right: string };

export type LanguageGlyphs = {
  /** Letters every text font must draw. */
  letters: string;
  /** Punctuation added where possible. */
  extra: string;
  /** Alternatives per character, best first. */
  recipes: Record<string, GlyphRecipe[]>;
};

const same = (from: string, transform?: GlyphTransform): GlyphRecipe =>
  transform ? { kind: 'same', from, transform } : { kind: 'same', from };

const donor = (left: string, right: string, from?: string, mirror = false): GlyphRecipe => ({
  kind: 'donor',
  left,
  right,
  ...(from && { from }),
  ...(mirror && { transform: 'mirror' as const }),
});

/** Latin twins; letters without one come from the donor. */
const UKRAINIAN_RECIPES: Record<string, GlyphRecipe[]> = {
  А: [same('A'), donor('A', 'A')],
  Б: [donor('E', 'B')],
  В: [same('B'), donor('E', 'B')],
  Г: [donor('F', 'F')],
  Ґ: [donor('F', 'F'), same('Г', 'upturn')],
  Д: [donor('A', 'A')],
  Е: [same('E'), donor('E', 'E')],
  Є: [donor('O', 'C'), donor('O', 'C', 'Э', true)],
  Ж: [donor('X', 'X')],
  З: [donor('S', 'B')],
  И: [donor('H', 'H')],
  І: [same('I'), donor('I', 'I')],
  Ї: [same('Ï'), donor('I', 'I')],
  Й: [donor('H', 'H')],
  К: [same('K'), donor('E', 'K')],
  Л: [donor('A', 'H')],
  М: [same('M'), donor('M', 'M')],
  Н: [same('H'), donor('H', 'H')],
  О: [same('O'), donor('O', 'O')],
  П: [donor('H', 'H')],
  Р: [same('P'), donor('P', 'P')],
  С: [same('C'), donor('O', 'C')],
  Т: [same('T'), donor('T', 'T')],
  У: [donor('Y', 'Y')],
  Ф: [donor('O', 'O')],
  Х: [same('X'), donor('X', 'X')],
  Ц: [donor('H', 'H')],
  Ч: [donor('H', 'H')],
  Ш: [donor('H', 'H')],
  Щ: [donor('H', 'H')],
  Ь: [donor('H', 'B')],
  Ю: [donor('H', 'O')],
  Я: [donor('O', 'H')],
  а: [same('a'), donor('o', 'n')],
  б: [donor('o', 'o')],
  в: [donor('n', 'o')],
  г: [donor('n', 'r')],
  ґ: [donor('n', 'r'), same('г', 'upturn')],
  д: [donor('o', 'n')],
  е: [same('e'), donor('o', 'e')],
  є: [donor('o', 'c'), donor('o', 'c', 'э', true)],
  ж: [donor('x', 'x')],
  з: [donor('s', 'o')],
  и: [donor('n', 'n')],
  і: [same('i'), donor('i', 'i')],
  ї: [same('ï'), donor('i', 'i')],
  й: [donor('n', 'n')],
  к: [donor('n', 'k')],
  л: [donor('x', 'n')],
  м: [donor('n', 'n')],
  н: [donor('n', 'n')],
  о: [same('o'), donor('o', 'o')],
  п: [donor('n', 'n')],
  р: [same('p'), donor('p', 'o')],
  с: [same('c'), donor('o', 'c')],
  т: [donor('x', 'x')],
  у: [same('y'), donor('y', 'y')],
  ф: [donor('o', 'o')],
  х: [same('x'), donor('x', 'x')],
  ц: [donor('n', 'n')],
  ч: [donor('n', 'n')],
  ш: [donor('n', 'n')],
  щ: [donor('n', 'n')],
  ь: [donor('n', 'o')],
  ю: [donor('n', 'o')],
  я: [donor('o', 'n')],
  ʼ: [same('’')],
  '’': [same("'")],
  '–': [same('-', 'dash')],
  '—': [same('–', 'dash'), same('-', 'dash')],
  '…': [same('.', 'ellipsis')],
  '№': [donor('N', 'O')],
};

const UKRAINIAN: LanguageGlyphs = {
  letters: 'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯабвгґдеєжзиіїйклмнопрстуфхцчшщьюя',
  extra: '«»’ʼ–—…№',
  recipes: UKRAINIAN_RECIPES,
};

const BY_LANGUAGE: Record<string, LanguageGlyphs> = { uk: UKRAINIAN };

/**
 * Letters, punctuation and recipes for a language, or `null` when none are known.
 *
 * @param lang - Language tag; the region is ignored, so `uk-UA` matches `uk`.
 */
export const languageGlyphs = (lang: string): LanguageGlyphs | null =>
  BY_LANGUAGE[lang.trim().toLowerCase().split(/[-_]/)[0]!] ?? null;
