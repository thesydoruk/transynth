/**
 * Dialogue text for a Fonix analysis that only knows English phonemes.
 *
 * Starfield's LipGenerator reads its text with Fonix in one of its own languages
 * (USEnglish by default). Cyrillic is filtered out, which leaves an audio-only
 * analysis with far fewer phonemes, and an empty argument breaks its argument parsing.
 * So the text is prepared the way FaceFXWrapper prepares it for the Fallout titles
 * (thesydoruk/FaceFXWrapper `Respell.cpp`, `Ukrainian.cpp`): `[tone tags]` are
 * dropped, Ukrainian is respelled into Latin "English-phoneme" spelling
 * (`привіт` → `prihveet`, not ISO transliteration), and the result is cleaned of the
 * characters that could be read as an option or break the command line.
 */

/** Cyrillic block; the respeller runs only on text that has a letter from it. */
const CYRILLIC_RE = /[Ѐ-ӿ]/;

/** Apostrophes inside a Ukrainian word (`з'їсти`): dropped, they carry no sound. */
const APOSTROPHES = new Set(["'", '`', '’', 'ʼ']);

/** Two-letter clusters read as one English sound, checked before the single letters. */
const CLUSTERS: Readonly<Record<string, string>> = {
  ьо: 'yo',
  йо: 'yo',
  дж: 'j',
  дз: 'dz',
};

/**
 * Ukrainian (and leftover Russian) letters → English spellings Fonix USEnglish reads
 * as the right phonemes. `и` is `ih`, `х` is `h` (Fonix reads "kh" as K).
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
  х: 'h',
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

const collapseWs = (text: string): string => text.replace(/\s+/g, ' ').trim();

const titleCase = (mapped: string, upper: boolean): string =>
  upper && mapped ? mapped[0]!.toUpperCase() + mapped.slice(1) : mapped;

const isUpper = (ch: string): boolean => ch !== ch.toLowerCase();

/** `[Сарказм] Привіт` → `Привіт`: bracketed tags are stage directions, not speech. */
export const stripToneTags = (text: string): string =>
  collapseWs(text.replace(/\[[^\]]*\]/g, ' ').replace(/[[\]]/g, ' '));

/** Respell Ukrainian for Fonix USEnglish; text without Cyrillic comes back unchanged. */
export const respellUkrainian = (text: string): string => {
  if (!CYRILLIC_RE.test(text)) return text;
  const chars = [...text.normalize('NFC')];
  let out = '';
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]!;
    const lower = ch.toLowerCase();
    const cluster = CLUSTERS[lower + (chars[i + 1] ?? '').toLowerCase()];
    if (cluster) {
      out += titleCase(cluster, isUpper(ch));
      i += 1;
      continue;
    }
    if (APOSTROPHES.has(ch)) continue;
    const mapped = LETTERS[lower];
    out += mapped === undefined ? ch : titleCase(mapped, isUpper(ch));
  }
  return collapseWs(out);
};

/**
 * Stand-in for a line with nothing to read (`[Laughs]`, `...`, or no text at all).
 * LipGenerator cannot take an empty argument; a lone punctuation mark gives the same
 * audio-only analysis as `,`, `...` or a space (byte-identical `.animset`s).
 */
export const AUDIO_ONLY_TEXT = '.';

export type LipGeneratorText = {
  /** What goes on LipGenerator's command line. */
  text: string;
  /** False when the line had nothing Fonix can read and the analysis is audio-only. */
  guided: boolean;
};

/**
 * Raw dialogue → LipGenerator's text argument: tags stripped, Ukrainian respelled,
 * double quotes and leading dashes removed (a leading `-` reads as an option), and
 * the audio-only stand-in when no letter or digit is left.
 */
export const prepareLipGeneratorText = (raw: string): LipGeneratorText => {
  const text = collapseWs(
    respellUkrainian(stripToneTags(raw))
      .replace(/"/g, '')
      .replace(/[\u0000-\u001F]/g, ' ')
      .replace(/^[\s\-‐-―]+/, ''),
  );
  if (!/[\p{L}\p{N}]/u.test(text)) return { text: AUDIO_ONLY_TEXT, guided: false };
  return { text, guided: true };
};
